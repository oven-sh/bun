#![allow(clippy::result_large_err, reason = "a build fails at most once")]

#[cfg(test)]
mod barrel_tests;
mod bind_stage;
#[cfg(test)]
mod files_of_tests_tests;
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
mod pieces_printed_in_place;
mod program_reach;
pub(crate) mod removable;
mod replaced_exports;
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
use self::replaced_exports::ExportedVariables;
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
    self, AddedNameRecord, EngineOptions, EngineRequest, EngineResult, FlowFindings,
    JudgeOfFlowFindings, builtin_of, feature_of, position_of,
};
use crate::ir::Program;
use crate::ir::generated::{BuiltinUse, FeatureUseKind, UnseenCodeCause};
use crate::ir::ids::{Id, ModuleId};
use crate::known_helpers::KnownHelpers;
use crate::link::{BodyRemap, Leftovers, ProgramNames, run_beside, run_one_after_the_other};
use crate::load::loaders::loader_by_path;
use crate::load::plugin_modules::is_path_of_entry_text;
use crate::load::replaced_builtins::{LeftOpenByText, ProductFiles};
use crate::load::replaced_by_tests::{
    ReadsLibrary, find_what_adding_matchers_writes, find_what_starting_worker_writes,
    scan_files_of_tests,
};
use crate::load::source_provider::SourceProvider;
use crate::load::worker_files::{WorkerFile, may_start_workers};
use crate::load::{PerProject, ProjectId, Sources, host_platform};
use crate::module_list::{ImportTarget, ModuleInput, ModuleList};
use crate::modules::{ApplicationGraph, DeferredData, ModuleGraph};
use crate::options::{
    EntryText, LibraryCode, LoadOptions, LoadsBelowFilesLeftToLoader, OpenedName, Options,
    PathOptions, ReplacedExport, WaysBetweenModuleObjects,
};
use crate::report::{ModuleLocator, SourceTexts};
use crate::statistics::{
    LimitId, LimitValues, Stage, StageClock, StatisticId, Statistics, StepClock, logs_stages,
};
use bstr::BStr;
use bun_ast::{Kind, Loader, Log, Msg};
use bun_core::{ZBox, strings};
use bun_options_types::aot_options::{Preload, ReplacedByTests, TargetPlatform};
use bun_sema::atom::Interner;
use bun_sema::check::aot::BuiltinTypeSymbols;
use bun_sema::program::{FileId, Files};
use bun_sema::resolve::{CodeHost, CodeImportKind};
use bun_sema::session::{Session, SessionSlot};
use bun_sema::util::{FxHashSet, SharedSort};
use bun_sema_driver::{
    ChosenThreads, CompileRequest, LoadedProgram, ThreadCaches, drop_thread_caches,
    for_each_parallel_in_runs, run_on_one_thread_while,
};
use bun_sys::{Fd, File};
use bun_threading::Guarded;
use bun_trim::Feature;
use core::cell::{Cell, OnceCell, RefCell};
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
    /// `Sources::holds_source_paths`
    pub(crate) holds_source_paths: bool,
    /// What of Bun's own code the programs use, by the word of the engine, and were handed over without.
    library_code_lacked: RuntimeUses,
    /// A program reads `process.mainModule`, by the word of the engine, and none of its files names a way to a module object.
    reads_main_module_without_its_name: bool,
    /// A program stores into `Bun.main`, by the word of the engine.
    stores_path_of_main_module: bool,
    /// A program stores into `Module._resolveFilename` or `Module.prototype.require`, by the word of the engine.
    stores_loader_functions: bool,
    /// A program reads them, by the word of the engine, and lets a module object go where the front end has not followed them.
    ways_read_out_of_sight: WaysBetweenModuleObjects,
    /// No program reads them, by the word of the engine, and the front end has followed them because a file names them.
    ways_named_that_nobody_reads: WaysBetweenModuleObjects,
    /// A spy of the test runner may replace them, by the word of the engine, and they were compiled as exports that keep their values.
    replaced_exports: Vec<ReplacedExport>,
    /// Tests were not analyzed, by the word of the engine, and their exports were compiled as exports that keep their values.
    lacks_replaceable_exports: bool,
    /// `interface::Compilation::replaced_builtins`
    pub(crate) replaced_builtins: ReplacedByTests,
    /// Tests may replace them, by the word of the engine, and they were compiled as members of built-in objects that are locked.
    builtins_found_by_flow: Vec<u32>,
    /// Tests may add them, by the word of the engine, and the objects were compiled as objects that take no new names.
    names_found_by_flow: Vec<OpenedName>,
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
    /// `find_root_folders_spelled`
    pub(crate) root_folders_spelled: Vec<u8>,
    /// `imports_file_with_query`
    pub(crate) imports_file_with_query: bool,
    /// Where code from disk may ask for them: the files of the program, for the names of their packages.
    pub(crate) program_files: Vec<EntryPointPaths>,
    pub code: CodeOfWorkers,
    /// What `find_code_that_starts_workers` found, and the `copies` that the engine saw passed to `new Worker()`.
    pub files: Vec<WorkerFile>,
    /// `CodeThatStartsWorkers::names`
    pub names: Vec<EntryPointPaths>,
    /// `CodeThatStartsWorkers::starts_of_files`
    pub starts_of_files: Vec<(Vec<u8>, FileId, u32)>,
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
    /// The file and the byte offset of each message of the checker, in ascending order. `None`: the build ended ahead of the check.
    pub errors_with_bun_types: Option<Vec<(Vec<u8>, u32)>>,
    /// `Diagnostics::has_early_errors`
    pub has_early_errors: bool,
    /// No failure: the files of a test run replace these members of built-in objects, and were loaded as if they were locked. See `compile`.
    pub replaced_builtins: Vec<u32>,
    /// No failure yet: every error of a test run stands in one of these files, which are no test files and fail where a test loads them. See `compile`.
    pub left_to_loader: Vec<Vec<u8>>,
    /// `None`: the build ended before it had followed what its files load. A file that the loader cannot read either loads nothing.
    pub loads_below_files_left_to_loader: Option<Arc<LoadsBelowFilesLeftToLoader>>,
    /// No failure: `LoadOptions::loaded_by_workers_too`. See `compile`.
    pub loaded_by_workers_too: Vec<Vec<u8>>,
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
    /// Whoever started the build goes on without the entry points that reach an error.
    names_refused_entry_points: bool,
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
    /// `BuildFailed::replaced_builtins`.
    pub(crate) replaced_builtins_spelled: Vec<u32>,
    /// `BuildFailed::loaded_by_workers_too`.
    pub(crate) loaded_by_workers_too: Vec<Vec<u8>>,
    /// `replaced_modules::packages_mock_modules_that_they_do_not_spell`.
    pub(crate) packages_mock_any_module: bool,
    /// Of a build of one program: `KnownWorkerFiles::splits` and `KnownWorkerFiles::left_out`.
    pub(crate) known_worker_files: Option<(bool, Vec<Vec<u8>>)>,
    /// `KnownWorkerFiles::of_the_one_program`, where the load can tell: it then ends ahead of all other stages.
    pub(crate) files_of_the_one_program: Vec<WorkerFile>,
    /// `KnownWorkerFiles::takes_in`
    pub(crate) takes_in_worker_files: Option<&'a dyn TakesInWorkerFiles>,
    /// `KnownWorkerFiles::took_in_too_much`
    pub(crate) took_in_too_much: bool,
    pub(crate) started_workers: StartedWorkers,
    /// `Compilation::replaced_builtins`, of the programs linked so far.
    pub(crate) replaced_builtins: ReplacedByTests,
    /// A test run in which no file of the tests can load what was not compiled.
    pub(crate) stays_in_compiled_files: bool,
    pub(crate) brings_bun_types: bool,
    pub(crate) has_withdrawn_trust: bool,
}

#[derive(Copy, Clone)]
pub(crate) struct ProgramsOfOneLoad<'a> {
    /// The position of the entry point of each among those of the build.
    pub indexes: &'a [usize],
    /// The options of each: it is the only entry point.
    pub options: &'a [Options<'a>],
    /// There is one program, and it begins at every entry point of its options.
    pub is_joined: bool,
    /// The build has no other entry points.
    pub are_all_of_the_build: bool,
    /// Of the program of a `WorkerFile`: `StartedWorkers::held_texts` of the programs before it.
    pub held_elsewhere: Option<&'a [(Vec<u8>, usize)]>,
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
    /// `Some`: the load may make such files entry points by itself while it runs. It hands them over and gets the options that the build goes on with.
    takes_in: Option<&'a dyn TakesInWorkerFiles>,
    /// Set by a build that ends because its load has made an entry point of a file that the search behind the load does not find. No failure either.
    took_in_too_much: &'a Cell<bool>,
}

pub(crate) trait TakesInWorkerFiles {
    /// The options with the files among the entry points.
    fn take_in(&self, files: &[WorkerFile]) -> &Options<'_>;
}

struct OptionsThatGrow<'r, 'o> {
    options: &'r Options<'o>,
    /// With the files that were taken in.
    longer: OnceCell<(Options<'o>, Vec<WorkerFile>)>,
}

impl TakesInWorkerFiles for OptionsThatGrow<'_, '_> {
    fn take_in(&self, files: &[WorkerFile]) -> &Options<'_> {
        let longer = || {
            (
                options_with_worker_files(self.options, files),
                files.to_vec(),
            )
        };
        &self.longer.get_or_init(longer).0
    }
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
    pub world_sessions: &'s [SessionSlot],
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
    /// `RuntimeRoots::asks` of a program that takes less of Bun's own code than its files name. What the load has read is the closure of this and of no more.
    pub library_code_asked: Option<&'b RuntimeUses>,
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

// The text of a module of JavaScript is its source, which the summary holds compressed anyway. Types are cut out of the others, so their lengths differ where the texts do.
// The engine asks for the text of a module where it lays out the text of functions. A program that leaves this process holds it.
fn put_function_texts_into(program: &mut Program, texts: &SourceTexts) {
    for (index, module) in program.modules.iter_mut().enumerate() {
        if let Some(source) = texts.get(ModuleId::new(index)) {
            module.function_text = source.function_text();
        }
    }
}

// An error quotes what failed from the text of the function. It knows the line and the column in the file, and these say where that is in a text without types.
fn put_types_cut_from_function_texts_into(program: &mut Program, texts: &SourceTexts) {
    for (index, module) in program.modules.iter_mut().enumerate() {
        if let Some(source) = texts.get(ModuleId::new(index)) {
            module.types_cut_from_function_text = source.types_cut_from_function_text().to_vec();
        }
    }
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
    /// `Sources::holds_source_paths`
    holds_source_paths: bool,
    held_library_code: HeldLibraryCode,
    names_way_to_module_objects: bool,
    has_commonjs_entry_point: bool,
    lets_process_out_of_sight: bool,
    is_ready_for_loader_functions: bool,
    ways_not_followed_out_of_sight: WaysBetweenModuleObjects,
    ways_followed_for_their_names: WaysBetweenModuleObjects,
    /// Of a build that runs tests.
    exported_variables: ExportedVariables,
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
    let failure = match link_program_with_options(options, provider, log) {
        Err(failure) if starts_over_without_brought_types(&options.load, &failure) => failure,
        linked @ (Ok(_) | Err(_)) => return linked,
    };
    log.msgs.truncate(said_before.0);
    (log.warnings, log.errors) = (said_before.1, said_before.2);
    provider.clear_embedded_files();
    let all: Vec<usize> = (0..options.entry_points.len()).collect();
    let mut options = options_with_entry_points(options, &all);
    options.load.takes_runtime_as_any = true;
    options.load.errors_with_bun_types = failure.errors_with_bun_types;
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
    failure.brought_bun_types
        && !failure.is_internal_error
        && !failure.has_early_errors
        && !load.takes_runtime_as_any
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
    watcher: Option<JoinHandle<Duration>>,
    began_at: Instant,
}

static BUILDS_THAT_KEEP_FREE_BLOCKS: AtomicUsize = AtomicUsize::new(0);
// Not the system's own mark: on Linux a spawned process starts from its parent's, and the log of phases resets it.
static MOST_RESIDENT_SEEN: AtomicUsize = AtomicUsize::new(0);

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
        KeepsFreeBlocksBelowThePeak {
            is_over,
            watcher,
            began_at: Instant::now(),
        }
    }

    /// Returns for how long it kept the free blocks.
    fn watch(is_over: &AtomicBool) -> Duration {
        let mut keeps_since: Option<Instant> = None;
        let mut kept_for = Duration::ZERO;
        let mut was_near_peak_at = Instant::now();
        while !is_over.load(Ordering::Acquire) {
            let resident = Self::resident_now();
            let seen_before = MOST_RESIDENT_SEEN.fetch_max(resident, Ordering::Relaxed);
            let peak = seen_before.max(resident);
            if resident / 100 >= peak / 10_000 * Self::PERCENT_OF_PEAK {
                was_near_peak_at = Instant::now();
            }
            let should_keep = was_near_peak_at.elapsed() >= Self::TIME_BEHIND_THE_PEAK;
            if should_keep != keeps_since.is_some() {
                Self::give_back(!should_keep);
                match keeps_since.take() {
                    Some(since) => kept_for += since.elapsed(),
                    None => keeps_since = Some(Instant::now()),
                }
            }
            std::thread::park_timeout(Self::TIME_BETWEEN_LOOKS);
        }
        Self::give_back(true);
        kept_for + keeps_since.map_or(Duration::ZERO, |since| since.elapsed())
    }

    fn give_back(gives_back: bool) {
        use bun_alloc::mimalloc::{Option, mi_option_set_default};
        mi_option_set_default(Option::purge_holes, gives_back.into());
    }

    fn resident_now() -> usize {
        let mut resident = 0;
        let unused = core::ptr::null_mut();
        // SAFETY: it writes a number through each pointer that is not null.
        unsafe {
            bun_alloc::mimalloc::mi_process_info(
                unused,
                unused,
                unused,
                &raw mut resident,
                unused,
                unused,
                unused,
                unused,
            );
        }
        resident
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
            let kept_for = watcher.join().unwrap_or_default();
            if logs_stages() {
                bun_core::print_errorln!(
                    "AOT free blocks | most resident seen {} MB | kept {} ms of {} ms",
                    MOST_RESIDENT_SEEN.load(Ordering::Relaxed) >> 20,
                    kept_for.as_millis(),
                    self.began_at.elapsed().as_millis(),
                );
            }
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

// A limit can only be lowered.
fn has_more_entry_points_than_programs(options: &Options<'_>) -> bool {
    let most = LimitValues::for_host().get(LimitId::MaxProgramsPerBuild);
    options.entry_points.len() as u64 > most
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
    let mut compiled = files.compiled_files().iter();
    imported.any(|id| RuntimeModule::from_registry_id(id.0) == module)
        || compiled.any(|&file| may_start_workers(files, file, constructor, module))
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
    found: &FlowFindings<'_>,
    held: &HeldLibraryCode,
    platform: Platforms,
) -> RuntimeUses {
    let used = found.builtins_used.iter();
    let used = used.filter_map(|record| builtin_of(record.builtin));
    let used: Vec<BuiltinId> = used.map(table::canonical_id).collect();
    let mut needed = RuntimeUses::of_entries_used(used.iter().copied(), platform);
    needed.add(&held.find_modules_left_out(&used));
    // Any name may reach a loader, and library code that is not compiled would run in the interpreter.
    if has_followed_nothing(found) {
        needed.add(&RuntimeUses::of_whole_library(platform));
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

fn log_unseen_code(engine: &EngineResult) {
    if !logs_stages() {
        return;
    }
    let records = engine.unseen_code();
    let count = |cause| records.iter().filter(|it| it.cause == cause).count();
    bun_core::print_errorln!(
        "AOT flow | code that the build does not see | loads code by name {} | loads compiled files by name {} | evaluates text {} | imports uncompiled code {} | runs unseen code {} | an option admits code {}",
        count(UnseenCodeCause::LoadsCodeByName),
        count(UnseenCodeCause::LoadsModuleByName),
        count(UnseenCodeCause::EvaluatesText),
        count(UnseenCodeCause::ImportsUncompiledModule),
        count(UnseenCodeCause::RunsUnseenCode),
        count(UnseenCodeCause::OptionAdmitsCode),
    );
}

// The engine did not analyze the program, so its lists of what is used are empty and say nothing.
fn has_followed_nothing(found: &FlowFindings<'_>) -> bool {
    let mut causes = found.unseen_code.iter().map(|record| record.cause);
    causes.any(|cause| cause == UnseenCodeCause::FlowResultDisabled)
}

// The analysis says which exports the spies of tests replace. Without it they may replace any.
fn lacks_replaceable_exports(options: &Options<'_>, found: &FlowFindings<'_>) -> bool {
    let load = &options.load;
    load.runs_tests
        && !load.mocks_any_module
        && !options.aot.checks_only
        && has_followed_nothing(found)
}

// An executable keeps track of which file is the main module where the front end has seen somebody ask.
// Code that the build does not see counts as reading all that it can get at, and is handed no module object of the program. Beside such code a read counts where code of the program lets `process` go out of sight.
fn reads_main_module(found: &FlowFindings<'_>, lets_process_out_of_sight: bool) -> bool {
    if has_followed_nothing(found) {
        return true;
    }
    let runs_unseen_code = found.unseen_code.iter().any(|record| {
        !matches!(
            record.cause,
            UnseenCodeCause::LoadsModuleByName | UnseenCodeCause::RunsMachineCode
        )
    });
    (!runs_unseen_code || lets_process_out_of_sight)
        && found.builtins_used.iter().any(|record| {
            record.uses.contains(BuiltinUse::READ)
                && matches!(
                    builtin_of(record.builtin).map(table::canonical_id),
                    Some(BuiltinId::ProcessMainModule | BuiltinId::ModuleRequireMain)
                )
        })
}

fn stores_path_of_main_module(found: &FlowFindings<'_>) -> bool {
    has_followed_nothing(found)
        || found.builtins_used.iter().any(|record| {
            record.uses.contains(BuiltinUse::STORED_BY_NAME)
                && builtin_of(record.builtin).map(table::canonical_id) == Some(BuiltinId::Bun_main)
        })
}

fn stores_loader_functions(found: &FlowFindings<'_>) -> bool {
    has_followed_nothing(found)
        || found.builtins_used.iter().any(|record| {
            record.uses.contains(BuiltinUse::STORED_BY_NAME)
                && matches!(
                    builtin_of(record.builtin).map(table::canonical_id),
                    Some(
                        BuiltinId::NodeModule_resolveFilename
                            | BuiltinId::NodeModulePrototypeRequire
                    )
                )
        })
}

// The files around a module object keep theirs where the front end has seen somebody ask for them. Where it has lost sight of the object the engine says whether anybody asks.
fn find_ways_read_out_of_sight(
    found: &FlowFindings<'_>,
    not_followed: WaysBetweenModuleObjects,
) -> WaysBetweenModuleObjects {
    if has_followed_nothing(found) {
        return not_followed;
    }
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
    found: &FlowFindings<'_>,
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
        linked_functions: Box::default(),
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

/// `FurtherLibraryCode::holds_test_files_alone`
pub(crate) fn holds_test_files_alone(options: &Options<'_>) -> bool {
    options.aot.is_part_of_test_files && options.aot.imports_are_in_other_images
}

pub(crate) fn chooses_library_code_by_names(options: &Options<'_>) -> bool {
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
    // The first image of the realm holds all of the library, compiled.
    if options.aot.imports_are_in_other_images {
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
        compiled.stores_path_of_main_module,
        compiled.stores_loader_functions,
        compiled.ways_read_out_of_sight,
        compiled.ways_named_that_nobody_reads,
        &compiled.replaced_exports,
        compiled.lacks_replaceable_exports,
        &compiled.builtins_found_by_flow,
        &compiled.names_found_by_flow,
    )
}

fn find_load_options_with(
    options: &Options<'_>,
    library_code_lacked: &RuntimeUses,
    reads_main_module_without_its_name: bool,
    stores_path_of_main_module: bool,
    stores_loader_functions: bool,
    ways_read_out_of_sight: WaysBetweenModuleObjects,
    ways_named_that_nobody_reads: WaysBetweenModuleObjects,
    replaced_exports: &[ReplacedExport],
    lacks_replaceable_exports: bool,
    replaced_builtins: &[u32],
    opened_names: &[OpenedName],
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
    if stores_path_of_main_module
        && !options.load.stores_path_of_main_module
        && !options.aot.checks_only
    {
        let load = load.get_or_insert_with(|| options.load.clone());
        load.stores_path_of_main_module = true;
    }
    if stores_loader_functions && !options.load.stores_loader_functions && !options.aot.checks_only
    {
        let load = load.get_or_insert_with(|| options.load.clone());
        load.stores_loader_functions = true;
    }
    let known = &options.load.replaced_exports;
    if (replaced_exports.iter()).any(|export| known.binary_search(export).is_err())
        && !options.aot.checks_only
    {
        let load = load.get_or_insert_with(|| options.load.clone());
        load.replaced_exports.extend_from_slice(replaced_exports);
        load.replaced_exports.shared_sort_unstable();
        load.replaced_exports.dedup();
    }
    if lacks_replaceable_exports {
        let load = load.get_or_insert_with(|| options.load.clone());
        load.mocks_any_module = true;
    }
    let known = &options.load.replaced_builtins;
    if (replaced_builtins.iter()).any(|member| known.binary_search(member).is_err())
        && !options.aot.checks_only
    {
        let load = load.get_or_insert_with(|| options.load.clone());
        load.replaced_builtins.extend_from_slice(replaced_builtins);
        load.replaced_builtins.shared_sort_unstable();
        load.replaced_builtins.dedup();
    }
    let known = &options.load.opened_names;
    if (opened_names.iter()).any(|name| known.binary_search(name).is_err())
        && !options.aot.checks_only
    {
        let load = load.get_or_insert_with(|| options.load.clone());
        load.opened_names.extend_from_slice(opened_names);
        load.opened_names.shared_sort_unstable();
        load.opened_names.dedup();
    }
    load
}

fn find_replaced_builtins(found: &FlowFindings<'_>) -> Vec<u32> {
    let records = found.builtins_that_tests_replace.iter();
    records.map(|record| record.member).collect()
}

fn find_opened_names(found: &FlowFindings<'_>) -> Vec<OpenedName> {
    let name_of = |record: &AddedNameRecord| {
        let start = record.name.offset as usize;
        found
            .text_of_names
            .get(start..start + record.name.length as usize)
    };
    (found.names_that_tests_add.iter())
        .filter_map(|record| {
            Some(OpenedName {
                holder: record.holder,
                name: name_of(record)?.to_vec(),
            })
        })
        .collect()
}

fn find_load_options_to_compile_again_with(
    options: &Options<'_>,
    compiled: &Result<Compilation, BuildFailed>,
) -> Option<LoadOptions> {
    let mut load = options.load.clone();
    match compiled {
        Err(failure) if !failure.replaced_builtins.is_empty() => {
            load.replaced_builtins
                .extend_from_slice(&failure.replaced_builtins);
            load.replaced_builtins.shared_sort_unstable();
            load.replaced_builtins.dedup();
        }
        Err(failure) if !failure.loaded_by_workers_too.is_empty() => {
            load.loaded_by_workers_too
                .extend_from_slice(&failure.loaded_by_workers_too);
            load.loaded_by_workers_too.shared_sort_unstable();
            load.loaded_by_workers_too.dedup();
        }
        // First: the types that the build brings are not to blame for a file that cannot be read.
        Err(failure)
            if (failure.left_to_loader.iter()).any(|file| !load.left_to_loader.contains(file)) =>
        {
            load.left_to_loader
                .extend_from_slice(&failure.left_to_loader);
            load.left_to_loader.shared_sort_unstable();
            load.left_to_loader.dedup();
            load.loads_below_files_left_to_loader
                .extend(failure.loads_below_files_left_to_loader.clone());
        }
        Err(failure) if starts_over_without_brought_types(&load, failure) => {
            load.takes_runtime_as_any = true;
            load.errors_with_bun_types
                .clone_from(&failure.errors_with_bun_types);
        }
        Ok(compiled) => return find_load_options_with_what_engine_found(options, compiled),
        Err(_) => return None,
    }
    Some(load)
}

fn log_why_build_starts_over(before: &LoadOptions, after: &LoadOptions) {
    let code = |load: &LoadOptions| {
        let code = &load.library_code_lacked;
        (
            code.modules.len(),
            code.exports_read.len(),
            code.functions.len(),
        )
    };
    let flags = |load: &LoadOptions| {
        [
            (
                "keeps library code without names",
                load.keeps_library_code_without_names,
            ),
            (
                "reads the main module without its name",
                load.reads_main_module_without_its_name,
            ),
            (
                "stores the path of the main module",
                load.stores_path_of_main_module,
            ),
            ("stores loader functions", load.stores_loader_functions),
            (
                "reads children out of sight",
                load.ways_read_out_of_sight.children,
            ),
            (
                "reads parent out of sight",
                load.ways_read_out_of_sight.parent,
            ),
            (
                "nobody reads children",
                load.ways_named_that_nobody_reads.children,
            ),
            (
                "nobody reads parent",
                load.ways_named_that_nobody_reads.parent,
            ),
            ("takes the run time as any", load.takes_runtime_as_any),
            ("mocks any module", load.mocks_any_module),
        ]
    };
    let changed: Vec<&str> = (flags(before).iter().zip(flags(after)))
        .filter(|(before, after)| before.1 != after.1)
        .map(|(_, after)| after.0)
        .collect();
    let new_functions = (after.library_code_lacked.functions.iter())
        .filter(|function| !before.library_code_lacked.functions.contains(function))
        .filter_map(|&function| table::runtime_function(RuntimeFunction(function)))
        .map(|data| format!("{}:{}", data.file, data.export_name))
        .collect::<Vec<_>>();
    let text_of_member = |member: u32| match builtin_of(member) {
        Some(builtin) => table::text_of(builtin),
        None => format!("(member {member})"),
    };
    let unlocked: Vec<String> = (after.replaced_builtins.iter())
        .filter(|member| before.replaced_builtins.binary_search(member).is_err())
        .map(|&member| text_of_member(member))
        .collect();
    if !unlocked.is_empty() {
        bun_core::print_errorln!(
            "AOT build starts over | replaced built-ins added: {}",
            unlocked.join(" "),
        );
    }
    let opened: Vec<String> = (after.opened_names.iter())
        .filter(|name| before.opened_names.binary_search(name).is_err())
        .map(|name| format!("{}.{}", text_of_member(name.holder), BStr::new(&name.name)))
        .collect();
    if !opened.is_empty() {
        bun_core::print_errorln!(
            "AOT build starts over | names opened on built-ins: {}",
            opened.join(" "),
        );
    }
    let left_to_loader: Vec<String> = (after.left_to_loader.iter())
        .filter(|file| !before.left_to_loader.contains(file))
        .map(|file| BStr::new(file).to_string())
        .collect();
    if !left_to_loader.is_empty() {
        bun_core::print_errorln!(
            "AOT build starts over | files left to the loader added: {} | {}",
            left_to_loader.len(),
            left_to_loader[..left_to_loader.len().min(8)].join(" "),
        );
    }
    let by_workers_too: Vec<String> = (after.loaded_by_workers_too.iter())
        .filter(|file| !before.loaded_by_workers_too.contains(file))
        .map(|file| BStr::new(file).to_string())
        .collect();
    if !by_workers_too.is_empty() {
        bun_core::print_errorln!(
            "AOT build starts over | files of the tests that Workers load read the names of the test runner by their realm: {} | {}",
            by_workers_too.len(),
            by_workers_too[..by_workers_too.len().min(8)].join(" "),
        );
    }
    let added = (after.replaced_exports.iter())
        .filter(|export| before.replaced_exports.binary_search(export).is_err());
    let (mut in_files, mut in_library) = (0usize, 0usize);
    let mut examples: Vec<String> = Vec::new();
    for export in added {
        let name = BStr::new(&export.name);
        let example = match &export.module {
            crate::options::ReplacedModule::File(path) => {
                in_files += 1;
                let file = strings::last_index_of_char(path, b'/').map_or(0, |slash| slash + 1);
                format!("{}:{}", BStr::new(&path[file..]), name)
            }
            crate::options::ReplacedModule::Runtime(id) => {
                in_library += 1;
                format!("library {}:{}", id, name)
            }
        };
        if examples.len() < 8 {
            examples.push(example);
        }
    }
    if !examples.is_empty() {
        bun_core::print_errorln!(
            "AOT build starts over | replaced exports added: {} in files, {} in the library | {}",
            in_files,
            in_library,
            examples.join(" "),
        );
    }
    let names_reason = !(unlocked.is_empty()
        && opened.is_empty()
        && left_to_loader.is_empty()
        && by_workers_too.is_empty()
        && examples.is_empty()
        && changed.is_empty()
        && code(before) == code(after));
    if !names_reason {
        bun_core::print_errorln!("AOT build starts over | THIS LOG HAS NO WORD FOR THE REASON");
    }
    bun_core::print_errorln!(
        "AOT build starts over | in all: replaced exports {} > {} | library modules, exports, functions lacked {:?} > {:?} | {} | {}",
        before.replaced_exports.len(),
        after.replaced_exports.len(),
        code(before),
        code(after),
        changed.join(", "),
        new_functions.join(" "),
    );
}

// How a file may be written where another one names it without its extension, or with the one that its output would have.
// Most of what a test run replaces on built-in objects stands in its test files and preloads, and in the helpers beside them. Read by themselves first, they save
// the load that finds it out and starts over.
fn with_builtins_that_entry_points_replace<'a>(options: &Options<'a>) -> Option<Options<'a>> {
    if !options.load.runs_tests || options.aot.checks_only {
        return None;
    }
    // The build of the lowest program read every file above it this way, these among them, and what it found came with the options.
    if !options.aot.images_below.is_empty() {
        return None;
    }
    let threads = options.thread_count().get();
    let product = match options.aot.only_tests_load_code_from_disk {
        true => ProductFiles::ReplaceNothing,
        false => ProductFiles::AreReadAsTestsAre,
    };
    // A layer of packages begins at files of packages. What the product imports replaces nothing.
    let of_product = &options.load.package_files_that_product_imports;
    let files = options.entry_points.iter();
    let files = files.filter(|path| of_product.binary_search(path).is_err());
    let is_test_file: FxHashSet<&[u8]> = (options.load.test_files.iter())
        .map(Vec::as_slice)
        .collect();
    let (test_files, others): (Vec<Vec<u8>>, Vec<Vec<u8>>) = files
        .cloned()
        .partition(|path| is_test_file.contains(path.as_slice()));
    let mut found = scan_files_of_tests(
        &test_files,
        &others,
        &[],
        threads,
        ReadsLibrary::No,
        product,
        None,
    );
    found
        .members
        .extend_from_slice(&options.load.replaced_builtins);
    found.members.shared_sort_unstable();
    found.members.dedup();
    // A file that the run loads from disk, a Worker's for one, is in no build, and writes in a realm that the image has locked.
    found
        .names_added
        .extend_from_slice(&options.load.opened_names);
    found.names_added.shared_sort_unstable();
    found.names_added.dedup();
    found
        .names_spied_in_text
        .extend_from_slice(&options.load.names_spied_in_text);
    found.names_spied_in_text.shared_sort_unstable();
    found.names_spied_in_text.dedup();
    found
        .modules_replaced_in_text
        .extend_from_slice(&options.load.modules_replaced_in_text);
    found.modules_replaced_in_text.shared_sort_unstable();
    found.modules_replaced_in_text.dedup();
    let spies_on_unknown_objects =
        options.load.spies_on_unknown_objects || found.left_open_by_text != LeftOpenByText::Nothing;
    let mocks_any_module = options.load.mocks_any_module
        || found.left_open_by_text == LeftOpenByText::MocksOfAnyModule;
    if found.members == options.load.replaced_builtins
        && found.names_added == options.load.opened_names
        && found.names_spied_in_text == options.load.names_spied_in_text
        && found.modules_replaced_in_text == options.load.modules_replaced_in_text
        && spies_on_unknown_objects == options.load.spies_on_unknown_objects
        && mocks_any_module == options.load.mocks_any_module
    {
        return None;
    }
    let all: Vec<usize> = (0..options.entry_points.len()).collect();
    let mut options = options_with_entry_points(options, &all);
    options.load.replaced_builtins = found.members;
    options.load.opened_names = found.names_added;
    options.load.names_spied_in_text = found.names_spied_in_text;
    options.load.modules_replaced_in_text = found.modules_replaced_in_text;
    options.load.spies_on_unknown_objects = spies_on_unknown_objects;
    options.load.mocks_any_module = mocks_any_module;
    Some(options)
}

fn with_builtins_that_starting_worker_writes<'a>(options: &Options<'a>) -> Option<Options<'a>> {
    let runs_unseen_code = options.aot.loads_code_from_disk || options.can_load_code_at_run_time();
    if !runs_unseen_code || options.load.runs_tests || options.aot.checks_only {
        return None;
    }
    let mut members = find_what_starting_worker_writes();
    members.extend_from_slice(&options.load.replaced_builtins);
    members.shared_sort_unstable();
    members.dedup();
    if members == options.load.replaced_builtins {
        return None;
    }
    let all: Vec<usize> = (0..options.entry_points.len()).collect();
    let mut options = options_with_entry_points(options, &all);
    options.load.replaced_builtins = members;
    Some(options)
}

fn with_builtins_that_adding_matchers_writes<'a>(options: &Options<'a>) -> Option<Options<'a>> {
    if !options.load.runs_tests || options.aot.checks_only {
        return None;
    }
    let mut members = find_what_adding_matchers_writes();
    members.extend_from_slice(&options.load.replaced_builtins);
    members.shared_sort_unstable();
    members.dedup();
    if members == options.load.replaced_builtins {
        return None;
    }
    let all: Vec<usize> = (0..options.entry_points.len()).collect();
    let mut options = options_with_entry_points(options, &all);
    options.load.replaced_builtins = members;
    Some(options)
}

/// The entry points of the last test build of the process that started over, and what it started over with.
static LEARNED_BY_TEST_BUILD: Guarded<Option<(Vec<Vec<u8>>, LoadOptions)>> = Guarded::new(None);

// `bun test --aot` builds again without the test files that reach an error. What the build of all the files found out holds for
// fewer of them, so the next one does not find it out again, which is a load or a whole front end each time.
fn with_what_test_build_learned<'a>(options: &Options<'a>) -> Option<Options<'a>> {
    if !options.load.runs_tests || options.aot.checks_only {
        return None;
    }
    let learned = LEARNED_BY_TEST_BUILD.lock();
    let (entry_points, learned) = learned.as_ref()?;
    let known: FxHashSet<&[u8]> = entry_points.iter().map(Vec::as_slice).collect();
    if !(options.entry_points.iter()).all(|path| known.contains(path.as_slice())) {
        return None;
    }
    let all: Vec<usize> = (0..options.entry_points.len()).collect();
    let mut options = options_with_entry_points(options, &all);
    let load = &mut options.load;
    load.replaced_builtins
        .extend_from_slice(&learned.replaced_builtins);
    load.replaced_builtins.shared_sort_unstable();
    load.replaced_builtins.dedup();
    load.opened_names.extend_from_slice(&learned.opened_names);
    load.opened_names.shared_sort_unstable();
    load.opened_names.dedup();
    load.replaced_exports
        .extend_from_slice(&learned.replaced_exports);
    load.replaced_exports.shared_sort_unstable();
    load.replaced_exports.dedup();
    load.left_to_loader
        .extend_from_slice(&learned.left_to_loader);
    load.left_to_loader.shared_sort_unstable();
    load.left_to_loader.dedup();
    load.loaded_by_workers_too
        .extend_from_slice(&learned.loaded_by_workers_too);
    load.loaded_by_workers_too.shared_sort_unstable();
    load.loaded_by_workers_too.dedup();
    for below in &learned.loads_below_files_left_to_loader {
        let known = &mut load.loads_below_files_left_to_loader;
        if !known.iter().any(|known| Arc::ptr_eq(known, below)) {
            known.push(Arc::clone(below));
        }
    }
    load.mocks_any_module |= learned.mocks_any_module;
    if learned.takes_runtime_as_any && !load.takes_runtime_as_any {
        load.takes_runtime_as_any = true;
        load.errors_with_bun_types
            .clone_from(&learned.errors_with_bun_types);
    }
    load.reads_main_module_without_its_name |= learned.reads_main_module_without_its_name;
    load.stores_path_of_main_module |= learned.stores_path_of_main_module;
    load.stores_loader_functions |= learned.stores_loader_functions;
    load.ways_read_out_of_sight
        .add(learned.ways_read_out_of_sight);
    load.ways_named_that_nobody_reads
        .add(learned.ways_named_that_nobody_reads);
    load.keeps_library_code_without_names |= learned.keeps_library_code_without_names;
    let mut library_code = library_code_of(&load.library_code_lacked);
    library_code.add(&library_code_of(&learned.library_code_lacked));
    load.library_code_lacked = numbers_of(&library_code);
    Some(options)
}

pub fn compile(
    options: &Options<'_>,
    provider: &dyn SourceProvider,
    log: &mut Log,
) -> Result<Compilation, BuildFailed> {
    let said_before = (log.msgs.len(), log.warnings, log.errors);
    let runs_before = (ENGINE_RUNS.get(), WHOLE_ENGINE_RUNS.get());
    SharedByLoads::begin_build();
    let mut changed: Option<Options<'_>> = with_builtins_that_entry_points_replace(options);
    if let Some(options) = with_what_test_build_learned(changed.as_ref().unwrap_or(options)) {
        changed = Some(options);
    }
    if let Some(options) =
        with_builtins_that_starting_worker_writes(changed.as_ref().unwrap_or(options))
    {
        changed = Some(options);
    }
    if let Some(options) =
        with_builtins_that_adding_matchers_writes(changed.as_ref().unwrap_or(options))
    {
        changed = Some(options);
    }
    let mut compiled = loop {
        let options = changed.as_ref().unwrap_or(options);
        let compiled = compile_with_options(options, provider, log);
        let Some(load) = find_load_options_to_compile_again_with(options, &compiled) else {
            break compiled;
        };
        if logs_stages() {
            log_why_build_starts_over(&options.load, &load);
        }
        if options.load.runs_tests {
            *LEARNED_BY_TEST_BUILD.lock() = Some((options.entry_points.clone(), load.clone()));
        }
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
    let mut load_takes_files_in = true;
    loop {
        let options = with_worker_files.as_ref().unwrap_or(options);
        let splits = with_worker_files.is_none() && can_have_several_programs(options);
        let of_the_one_program = RefCell::new(Vec::new());
        let grows = OptionsThatGrow {
            options,
            longer: OnceCell::new(),
        };
        let took_in_too_much = Cell::new(false);
        let known = KnownWorkerFiles {
            splits,
            left_out: &left_out.names,
            of_the_one_program: &of_the_one_program,
            takes_in: match load_takes_files_in && with_worker_files.is_none() {
                true => Some(&grows),
                false => None,
            },
            took_in_too_much: &took_in_too_much,
        };
        let compiled = match with_worker_files {
            None => compile_written_entry_points(options, known, provider, log),
            Some(_) => compile_program(options, ProgramPlace::Only, known, provider, log),
        };
        if took_in_too_much.get() {
            if logs_stages() {
                bun_core::print_errorln!(
                    "AOT build starts over | the load took in too much: the next one takes in no file that a Worker starts from"
                );
            }
            load_takes_files_in = false;
            log.msgs.truncate(said_before.0);
            (log.warnings, log.errors) = (said_before.1, said_before.2);
            provider.clear_embedded_files();
            continue;
        }
        let of_the_one_program = of_the_one_program.into_inner();
        // What was compiled is what a build with these files among its entry points compiles.
        let holds_worker_files = with_worker_files.is_some() || grows.longer.get().is_some();
        let splits = splits && grows.longer.get().is_none();
        let options = match grows.longer.get() {
            Some((longer, files)) => {
                left_out.note_worker_files(files);
                longer
            }
            None => options,
        };
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
                    Err(found) => {
                        log_worker_files_that_build_starts_over_for(&found);
                        left_out.add_worker_files(options, &found)
                    }
                }
            }
            Err(_) if !of_the_one_program.is_empty() => {
                log_worker_files_that_build_starts_over_for(&of_the_one_program);
                left_out.add_worker_files(options, &of_the_one_program)
            }
            Err(failure) if !holds_worker_files => return Err(failure),
            Err(failure) => {
                let texts = &options.load.entry_texts;
                let starts_over = starts_over_without_brought_types(&options.load, &failure);
                if starts_over
                    || !fails_to_load(&failure)
                    || (!left_out.take_texts_with_errors(log, said_before.0, texts, &failure)
                        && !left_out.take_files_named_by_paths(log, said_before.0, &failure))
                {
                    return Err(failure);
                }
                if logs_stages() {
                    let names: Vec<String> = (left_out.names.iter().rev().take(8))
                        .map(|name| BStr::new(name).to_string())
                        .collect();
                    bun_core::print_errorln!(
                        "AOT build starts over | what Workers start from and is no program is left out: {} in all | {}",
                        left_out.names.len(),
                        names.join(" "),
                    );
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

fn log_worker_files_that_build_starts_over_for(files: &[WorkerFile]) {
    if !logs_stages() {
        return;
    }
    let names: Vec<String> = (files.iter().take(8))
        .map(|file| BStr::new(&file.source_path).to_string())
        .collect();
    bun_core::print_errorln!(
        "AOT build starts over | files that Workers start from become entry points: {} | {}",
        files.len(),
        names.join(" "),
    );
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
        self.note_worker_files(files);
        options_with_worker_files(options, files)
    }

    fn note_worker_files(&mut self, files: &[WorkerFile]) {
        let named = files.iter().filter(|file| file.is_named_by_path);
        self.named_by_paths
            .extend(named.map(|file| file.source_path.clone()));
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
        let added = &mut longer.load.entry_points_added_by_build;
        added.push(file.source_path.clone());
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
    files.shared_sort_by_key(|file| file.is_guess);
    let with_options = files.iter().filter(|file| file.has_options);
    let with_options: FxHashSet<Vec<u8>> = with_options.map(|it| it.source_path.clone()).collect();
    for file in &mut files {
        file.has_options = with_options.contains(&file.source_path);
    }
    let are_too_many = splits && are_too_many_programs(&first, &files, left_out);
    let mut pending: VecDeque<WorkerFile> = files.into();
    let mut found: Vec<WorkerFile> = Vec::new();
    let mut texts_not_started: Vec<WorkerFile> = Vec::new();
    let mut are_one_program = !splits || are_too_many;
    let mut joins_guesses = true;
    // The entry points and `found`.
    let entry_points = first.summary.entry_points.iter();
    let mut known: FxHashSet<Vec<u8>> = entry_points.map(|it| it.source_path.clone()).collect();
    while let Some(file) = pending.pop_front() {
        let is_known = known.contains(&file.source_path);
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
        known.insert(file.source_path.clone());
        let first_found = found.len();
        found.push(file);
        are_one_program = must_be_one_program;
        if are_one_program {
            continue;
        }
        // A server that embeds its pages has many guesses. All that wait begin one program: a program costs more than a small file does.
        if is_guess && joins_guesses {
            let writes_preload = first.started_workers.writes_preload;
            pending.retain(|other| {
                let joins = other.is_guess
                    && !(writes_preload && other.has_options)
                    && !left_out.names.contains(&other.source_path)
                    && known.insert(other.source_path.clone());
                if joins {
                    found.push(other.clone());
                }
                !joins
            });
        }
        let said_before = log.msgs.len();
        let counted_before = (log.warnings, log.errors);
        let own = options_with_worker_files(options, &found[first_found..]);
        let first_added = options.entry_points.len();
        let added: Vec<usize> = (first_added..own.entry_points.len()).collect();
        let own = options_with_entry_points(&own, &added);
        let of_one_load = ProgramsOfOneLoad {
            indexes: &[index],
            options: core::slice::from_ref(&own),
            is_joined: added.len() > 1,
            are_all_of_the_build: false,
            held_elsewhere: Some(&first.started_workers.held_texts),
        };
        let compiled = compile_programs(&own, Some(of_one_load), None, provider, log);
        forget_repeated_messages(log, said_before);
        let program = match compiled {
            // The file was not written for a Worker. It stays a plain embedded file.
            Err(failure) if is_guess => {
                log.msgs.truncate(said_before);
                (log.warnings, log.errors) = counted_before;
                let tried = found.split_off(first_found);
                let refused = failure.refused_entry_points.unwrap_or_default();
                // Nothing says which of them the errors come from, so each is tried alone.
                joins_guesses &= tried.len() == 1 || !refused.is_empty();
                for (position, file) in (0..).zip(tried) {
                    if added.len() == 1 || refused.contains(&position) {
                        first.started_workers.left_out.push(file);
                    } else {
                        known.remove(&file.source_path);
                        pending.push_back(file);
                    }
                }
                continue;
            }
            Err(failure) if failure.is_one_program => None,
            // `compile` starts over without the declarations. Only what is wrong then is wrong with the code.
            Err(failure) if starts_over_without_brought_types(&own.load, &failure) => {
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
                texts_not_started.extend(take_back(&mut found, &mut known));
                continue;
            }
            Err(failure) if is_named_by_path && fails_to_load(&failure) => {
                left_out.take_errors(log, said_before);
                (log.warnings, log.errors) = counted_before;
                left_out
                    .names
                    .extend(found.last().map(|file| file.source_path.clone()));
                texts_not_started.extend(take_back(&mut found, &mut known));
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
            _ if is_guess => {
                let tried = found.split_off(first_found);
                first.started_workers.left_out.extend(tried);
            }
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
    texts_not_started.shared_sort_unstable();
    texts_not_started.dedup();
    for text in &texts_not_started {
        first.started_workers.code = CodeOfWorkers::Unseen;
        let place = text.started_at.as_ref();
        log_diagnostic_at(&mut left_out.said, Code::WorkerTextNotCompiled, &[], place);
    }
    Ok(Ok(first))
}

fn take_back(found: &mut Vec<WorkerFile>, known: &mut FxHashSet<Vec<u8>>) -> Option<WorkerFile> {
    let file = found.pop()?;
    known.remove(&file.source_path);
    Some(file)
}

// Past the limit all are one program. Knowing that ahead saves compiling a program for each file up to the limit and discarding them.
fn are_too_many_programs(
    first: &Compilation,
    files: &[WorkerFile],
    left_out: &TextsLeftOut,
) -> bool {
    let entry_points = source_paths_of(&first.summary.entry_points);
    let begins_program = |file: &&WorkerFile| {
        !file.is_guess
            && !left_out.names.contains(&file.source_path)
            && !entry_points.contains(&file.source_path[..])
    };
    let mut further: Vec<&[u8]> = (files.iter().filter(begins_program))
        .map(|file| &file.source_path[..])
        .collect();
    further.shared_sort_unstable();
    further.dedup();
    let most = LimitValues::for_host().get(LimitId::MaxProgramsPerBuild);
    (entry_points.len() + further.len()) as u64 > most
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
    files.shared_sort_by_cached_key(key);
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
    first.holds_source_paths |= program.holds_source_paths;
    first.library_code_lacked.add(&program.library_code_lacked);
    first.reads_main_module_without_its_name |= program.reads_main_module_without_its_name;
    first.stores_path_of_main_module |= program.stores_path_of_main_module;
    first.stores_loader_functions |= program.stores_loader_functions;
    (first.ways_read_out_of_sight).add(program.ways_read_out_of_sight);
    (first.ways_named_that_nobody_reads).add(program.ways_named_that_nobody_reads);
    first.replaced_exports.extend(program.replaced_exports);
    first.lacks_replaceable_exports |= program.lacks_replaceable_exports;
    (first.builtins_found_by_flow).extend(program.builtins_found_by_flow);
    first
        .names_found_by_flow
        .extend(program.names_found_by_flow);
    let (all, further) = (&mut first.replaced_builtins, program.replaced_builtins);
    all.builtins.extend(further.builtins);
    (all.names_added_to_builtins).extend(further.names_added_to_builtins);
    (all.parameters_that_start_workers).extend(further.parameters_that_start_workers);
    all.stores_loader_functions |= further.stores_loader_functions;
    all.evicts_any_module |= further.evicts_any_module;
    all.any_module |= further.any_module;
    all.spies_on_unknown_objects |= further.spies_on_unknown_objects;
    (all.names_spied_on_unknown_objects).extend(further.names_spied_on_unknown_objects);
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
    // They are one program whatever the files say, so nothing is loaded to find that out. The load of the one program says whether
    // the count alone has joined them.
    if has_more_entry_points_than_programs(options) {
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

/// `--aot-out`, or for measuring the word `TestRunProgramFile:<path>`: the same for a test run that is built as one program.
fn program_file_path<'a>(options: &'a Options<'_>) -> Option<&'a [u8]> {
    let of_test_run = || {
        let words = bun_core::env_var::BUN_DEBUG_TEST_AOT_WORDS.get_not_empty()?;
        let mut words = bun_core::strings::split(words, b",");
        words.find_map(|word| word.strip_prefix(b"TestRunProgramFile:"))
    };
    let written = options.aot.ir_output_path.as_deref();
    written.or_else(|| of_test_run().filter(|_| options.load.runs_tests))
}

fn remove_program_files_of_further_entry_points(options: &Options<'_>) {
    if let Some(path) = program_file_path(options) {
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
            is_joined: false,
            are_all_of_the_build: indexes.len() == count,
            held_elsewhere: None,
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
                            program.stores_path_of_main_module = false;
                            program.stores_loader_functions = false;
                            program.ways_read_out_of_sight = WaysBetweenModuleObjects::default();
                            program.ways_named_that_nobody_reads =
                                WaysBetweenModuleObjects::default();
                            program.replaced_exports = Vec::new();
                            program.builtins_found_by_flow = Vec::new();
                            program.names_found_by_flow = Vec::new();
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
    known_worker_files: Option<KnownWorkerFiles<'a>>,
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
    build.known_worker_files =
        known_worker_files.map(|known| (known.splits, known.left_out.to_vec()));
    build.takes_in_worker_files = known_worker_files.and_then(|known| known.takes_in);
    let body_placement = match program_file_path(options) {
        Some(_) => BodyPlacement::InProgramBytes,
        None => BodyPlacement::External,
    };
    let mut outputs = match build.run_front_end_for_each_program() {
        Ok(outputs) => outputs,
        Err(_) if build.has_left_all_entry_points => Vec::new(),
        Err(stage) => {
            if let Some(known) = known_worker_files {
                let files = core::mem::take(&mut build.files_of_the_one_program);
                known.of_the_one_program.replace(files);
                known.took_in_too_much.set(build.took_in_too_much);
            }
            let (is_one_program, brought_bun_types) =
                (build.is_one_program, build.brings_bun_types);
            let replaced_builtins = core::mem::take(&mut build.replaced_builtins_spelled);
            let by_workers_too = core::mem::take(&mut build.loaded_by_workers_too);
            let mut failure = build.finish::<()>(Err(stage), log).unwrap_err();
            failure.replaced_builtins = replaced_builtins;
            failure.loaded_by_workers_too = by_workers_too;
            failure.is_one_program = is_one_program;
            failure.brought_bun_types = brought_bun_types;
            return Err(failure);
        }
    };
    // Of one program: its load may have gone on with more entry points.
    let options = match programs {
        None => build.options,
        Some(_) => options,
    };
    engine_options.wait_for_images_below(&options.aot.images_below);
    outputs.shared_sort_by_key(|(place, _)| match *place {
        ProgramPlace::Only => 0,
        ProgramPlace::OneOfSeveral(index) => index,
    });
    if let (Some(known), [(_, output)]) = (known_worker_files, &outputs[..]) {
        let splits = (build.known_worker_files.as_ref()).is_some_and(|known| known.0);
        let known = KnownWorkerFiles { splits, ..known };
        let started = &build.started_workers;
        let worker_files = find_files_of_the_one_program(known, started, output);
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
        if build.stays_in_compiled_files {
            engine_options.refuse_code_outside_image();
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
        let is_ready_for_loader_functions = output.is_ready_for_loader_functions;
        let ways_not_followed = output.ways_not_followed_out_of_sight;
        let ways_followed = output.ways_followed_for_their_names;
        let exported_variables = &output.exported_variables;
        let find_lacked =
            |found: &FlowFindings<'_>| find_library_code_lacked(found, held, platform);
        // A program that is compiled again, with what the engine has found: nothing is made of it now.
        let goes_on = |found: FlowFindings<'_>| {
            let found = &found;
            let lacked = find_lacked(found);
            let reads_main_module =
                lacks_main_module && reads_main_module(found, lets_process_out_of_sight);
            let ways = find_ways_read_out_of_sight(found, ways_not_followed);
            let nobody_reads = find_ways_named_that_nobody_reads(found, ways_followed);
            let load = find_load_options_with(
                own,
                &lacked,
                reads_main_module,
                stores_path_of_main_module(found),
                !is_ready_for_loader_functions && stores_loader_functions(found),
                ways,
                nobody_reads,
                &exported_variables.find_replaced(found),
                lacks_replaceable_exports(own, found),
                &find_replaced_builtins(found),
                &find_opened_names(found),
            );
            load.is_none()
        };
        programs_to_ask -= 1;
        let whole_runs = WHOLE_ENGINE_RUNS.get();
        let further_load = match is_loaded_again || programs_to_ask > 0 {
            true => FurtherLoad::MayCome,
            false => FurtherLoad::ComesIfRunEnds,
        };
        let engine = build.run_engine(bytes, &engine_options, &output, &goes_on, further_load);
        is_loaded_again |= WHOLE_ENGINE_RUNS.get() == whole_runs;
        library_code_lacked.push(find_lacked(&engine.flow_findings()));
        if let Some(modules) = &mut output.modules {
            modules.count_code(engine.functions(), &output.names);
        }
        compiled.push((place, engine, output));
    }
    let has_errors = build.diagnostics.has_errors();
    let is_internal_error = build.diagnostics.has_internal_errors();
    let brought_bun_types = build.brings_bun_types;
    let errors_with_bun_types = build.diagnostics.take_places_of_type_errors();
    let refused_entry_points = build.find_refused_entry_points();
    let left_entry_points = core::mem::take(&mut build.left_entry_points);
    let mut started_workers = core::mem::take(&mut build.started_workers);
    started_workers.held_texts.shared_sort_unstable();
    started_workers.writes_preload = compiled.iter().any(|it| it.2.writes_preload);
    let mut reported: Vec<WorkerFile> = Vec::new();
    for (_, engine, output) in &compiled {
        // The search for the code of Workers begins where the constructor is named.
        if !engine.worker_starts_without_name().is_empty() {
            started_workers.code = CodeOfWorkers::Unseen;
        }
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
        // Any code file that the program embeds may be what it starts a Worker with.
        if has_followed_nothing(&engine.flow_findings()) {
            reported.extend(started_workers.copies.iter().map(|copy| WorkerFile {
                is_guess: true,
                has_options: true,
                ..copy.clone()
            }));
        }
    }
    reported.shared_sort_unstable();
    started_workers.files.extend(reported);
    let mut started_workers = Some(started_workers);
    let mut replaced_builtins = Some(core::mem::take(&mut build.replaced_builtins));
    build.clock.add_to(&mut build.statistics);
    build.diagnostics.write_to(log);
    let statistics = build.statistics;
    let mut programs: Vec<(ProgramPlace, Compilation)> = compiled
        .into_iter()
        .zip(library_code_lacked)
        .map(|((place, engine, output), library_code_lacked)| {
            let reads_main_module_without_its_name = output.lacks_main_module()
                && reads_main_module(&engine.flow_findings(), output.lets_process_out_of_sight);
            let stores_path_of_main_module = stores_path_of_main_module(&engine.flow_findings());
            let stores_loader_functions = !output.is_ready_for_loader_functions
                && stores_loader_functions(&engine.flow_findings());
            let ways_read_out_of_sight = find_ways_read_out_of_sight(
                &engine.flow_findings(),
                output.ways_not_followed_out_of_sight,
            );
            let ways_named_that_nobody_reads = find_ways_named_that_nobody_reads(
                &engine.flow_findings(),
                output.ways_followed_for_their_names,
            );
            let replaced_exports =
                (output.exported_variables).find_replaced(&engine.flow_findings());
            let lacks_replaceable_exports =
                lacks_replaceable_exports(options, &engine.flow_findings());
            let builtins_found_by_flow = find_replaced_builtins(&engine.flow_findings());
            let names_found_by_flow = find_opened_names(&engine.flow_findings());
            let holds_source_paths = output.holds_source_paths;
            let (_, summary) = output.into_parts(statistics.clone());
            let compilation = Compilation {
                replaced_exports,
                lacks_replaceable_exports,
                reads_main_module_without_its_name,
                stores_path_of_main_module,
                stores_loader_functions,
                ways_read_out_of_sight,
                ways_named_that_nobody_reads,
                engine,
                summary,
                further_programs: Vec::new(),
                // Of all that was loaded.
                started_workers: started_workers.take().unwrap_or_default(),
                holds_source_paths,
                replaced_builtins: replaced_builtins.take().unwrap_or_default(),
                builtins_found_by_flow,
                names_found_by_flow,
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
            errors_with_bun_types,
            has_early_errors: false,
            replaced_builtins: Vec::new(),
            left_to_loader: Vec::new(),
            loads_below_files_left_to_loader: None,
            loaded_by_workers_too: Vec::new(),
        }),
    }
}

// What `add_programs_of_worker_files` answers with `Err`, as far as the front end can tell: the engine then runs once, for the program that holds them all.
fn find_files_of_the_one_program(
    known: KnownWorkerFiles<'_>,
    started: &StartedWorkers,
    output: &FrontEndOutput,
) -> Vec<WorkerFile> {
    let entry_points = source_paths_of(&output.entry_points);
    let files =
        find_further_worker_files(started, known.left_out, |path| entry_points.contains(path));
    let has_options = files.iter().any(|file| file.has_options);
    match joins_workers(known.splits, started) || (output.writes_preload && has_options) {
        true => files,
        false => Vec::new(),
    }
}

/// Whether the files that Workers start from are entry points of the program that starts them, as far as its load can tell.
fn joins_workers(splits: bool, started: &StartedWorkers) -> bool {
    // The host loads node:worker_threads into the global of a Worker of that module. So its program holds the module and the streams, the
    // console and the file system behind it, as does the program that constructs it: on their own each would compile a copy of all that.
    !splits || started.constructs_node_workers
}

fn source_paths_of(entry_points: &[EntryPointPaths]) -> FxHashSet<&[u8]> {
    let paths = entry_points.iter().map(|it| &it.source_path[..]);
    paths.collect()
}

/// The files that Workers start from and that are no entry points yet.
fn find_further_worker_files(
    started: &StartedWorkers,
    left_out: &[Vec<u8>],
    is_entry_point: impl Fn(&[u8]) -> bool,
) -> Vec<WorkerFile> {
    let mut files: Vec<WorkerFile> = (started.files.iter())
        .filter(|file| !is_entry_point(&file.source_path) && !left_out.contains(&file.source_path))
        .cloned()
        .collect();
    files.dedup_by(|repeated, kept| {
        let is_same = repeated.source_path == kept.source_path;
        kept.has_options |= is_same && repeated.has_options;
        is_same
    });
    files
}

fn fail(
    stage: Stage,
    mut diagnostics: Diagnostics,
    statistics: Statistics,
    refused_entry_points: Option<Vec<u32>>,
    log: &mut Log,
) -> BuildFailed {
    let is_internal_error = diagnostics.has_internal_errors();
    let has_early_errors = diagnostics.has_early_errors();
    let errors_with_bun_types = diagnostics.take_places_of_type_errors();
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
        errors_with_bun_types,
        replaced_builtins: Vec::new(),
        left_to_loader: Vec::new(),
        loads_below_files_left_to_loader: None,
        loaded_by_workers_too: Vec::new(),
    }
}

impl<'a> Build<'a> {
    pub(crate) fn mocks_any_module(&self) -> bool {
        self.options.load.mocks_any_module || self.packages_mock_any_module
    }

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
            names_refused_entry_points: false,
            checked_elsewhere: Vec::new(),
            place: ProgramPlace::Only,
            programs: None,
            left_entry_points: Vec::new(),
            has_left_all_entry_points: false,
            is_preloading: false,
            is_one_program: false,
            replaced_builtins_spelled: Vec::new(),
            loaded_by_workers_too: Vec::new(),
            packages_mock_any_module: false,
            known_worker_files: None,
            files_of_the_one_program: Vec::new(),
            takes_in_worker_files: None,
            took_in_too_much: false,
            started_workers: StartedWorkers::default(),
            replaced_builtins: ReplacedByTests::default(),
            stays_in_compiled_files: false,
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

    // One file with a mistake, or with data that the compiler cannot hold, costs a test run nothing but what `bun test` loses to it.
    fn find_files_to_leave_to_loader(&self) -> Vec<Vec<u8>> {
        let load = &self.options.load;
        let holds_code = |path: &[u8]| {
            loader_by_path(&load.loaders, path, CodeImportKind::Import).is_java_script_like()
        };
        let mut files = self.diagnostics.files_that_fail_at_load(holds_code);
        files.retain(|path| !self.options.entry_points.contains(path));
        // An executable holds whatever `import(name)` may find, and a package brings files that nobody ever loads: a tsconfig with comments, a fixture with a mistake.
        // `bun run` says what is wrong with one where the program loads it. A file that a site spells stops the build, as it stops `bun build`.
        if !load.runs_tests {
            let graph = self.import_graph.as_ref();
            files.retain(|path| graph.is_some_and(|it| it.is_found_by_computed_names_alone(path)));
        }
        files
    }

    /// Its entry points are the files that the test files above it load. None of them is a test file.
    fn holds_files_for_programs_above(&self) -> bool {
        self.options.load.runs_tests && self.options.load.every_export_is_asked_for
    }

    // Such a file leaves the layer as a refused entry point does. `bun test` says what is wrong with it where a test file loads it, and nowhere else.
    fn forget_errors_that_loader_reports(&mut self) {
        let loaders = &self.options.load.loaders;
        let holds_code = |path: &[u8]| {
            loader_by_path(loaders, path, CodeImportKind::Import).is_java_script_like()
        };
        let files = self.diagnostics.files_that_fail_at_load(holds_code);
        self.diagnostics.forget_errors_in(&files);
    }

    fn find_loads_below(&self, left: &[Vec<u8>]) -> Option<Arc<LoadsBelowFilesLeftToLoader>> {
        // In an executable no loader reads such a file, so none asks for what it imports.
        let is_read_by_loader = !left.is_empty() && self.options.load.runs_tests;
        let graph = self.import_graph.as_ref().filter(|_| is_read_by_loader)?;
        Some(Arc::new(graph.find_loads_below(left)))
    }

    fn find_refused_entry_points(&self) -> Option<Vec<u32>> {
        let paths = self.diagnostics.paths_of_errors()?;
        let graph = self.import_graph.as_ref();
        let graph = graph.filter(|_| self.names_refused_entry_points)?;
        graph.find_entry_points_that_reach(paths.into_iter())
    }

    fn run_front_end(&mut self) -> Result<FrontEndOutput, Stage> {
        let mut outputs = self.run_front_end_for_each_program()?;
        Ok(outputs.pop().expect("a build has a program").1)
    }

    fn run_front_end_for_each_program(
        &mut self,
    ) -> Result<Vec<(ProgramPlace, FrontEndOutput)>, Stage> {
        let mut linked_at = None;
        let mut steps_behind_link = None;
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
                crate::statistics::log_why_files_are_loaded_again(format_args!(
                    "as one program: a module is loaded by a computed name"
                ));
                build.is_one_program = true;
                return Err(Stage::BindModules);
            }
            // From here on the front end takes most of its memory. The build of the program below has let go of its own by then.
            build.options.aot.images_below.wait();
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
            steps_behind_link = Some(StepClock::new(Stage::LinkAndEmit, "behind the link"));
            // The host loads what `preload` names into the global of the Worker. An object has that option only in a program that
            // writes a property of its name.
            if starts_workers && matches!(&output, Ok(output) if output.writes_preload) {
                crate::statistics::log_why_files_are_loaded_again(format_args!(
                    "as one program: an object has a property `preload`"
                ));
                build.is_one_program = true;
                return Err(Stage::LinkAndEmit);
            }
            // A load that has to be done again begins with the first program again.
            outputs.retain(|(place, _)| *place != build.place);
            outputs.push((build.place, output?));
            Ok(())
        });
        if let Some(steps) = &mut steps_behind_link {
            steps.end("what was loaded is let go");
        }
        drop_thread_caches(self.caches);
        if let Some(steps) = &mut steps_behind_link {
            steps.end("the threads' caches are dropped");
        }
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
        let mut steps = StepClock::new(Stage::LinkAndEmit, "emit");
        // Emit asks nothing of the sessions, and few threads have something to free.
        let sessions = core::mem::take(&mut self.retired_sessions);
        let runner_of_drops = self.parallel_runner();
        let writes_program_file = program_file_path(self.options).is_some();
        put_types_cut_from_function_texts_into(&mut program, &output.texts);
        // A test run quotes from the files, so nothing moves its pieces.
        let faults = match self.options.load.runs_tests {
            true => Vec::new(),
            false => {
                let words = &self.options.aot.option_words;
                let mut lists = (program.modules.iter_mut())
                    .map(|module| &mut module.positions.text_printed_in_place);
                if (words.iter()).any(|it| **it == *b"sabotage=ListsOfPiecesEndInAPiece")
                    && let Some(list) = lists.find(|list| !list.is_empty())
                {
                    list.push(1);
                }
                pieces_printed_in_place::find_faults_in_program(&program)
            }
        };
        // The list buys the wording of what an error quotes: a fault in one costs the file that, and nobody a build.
        // Where Bun has assertions it stops the build, so that our tests find it.
        for (module, fault) in faults {
            let source = output.texts.get(ModuleId::new(module));
            let path = source.map_or(&[][..], |source| &source.path[..]);
            if cfg!(debug_assertions) {
                let message = [path, b": ", fault.to_string().as_bytes()].concat();
                self.diagnostics.add_fault_of_emitted_program(message);
                return Err(Stage::LinkAndEmit);
            }
            let fault = fault.to_string();
            self.diagnostics
                .add_text_quoted_as_written(path, fault.as_bytes());
            program.modules[module]
                .positions
                .text_printed_in_place
                .clear();
        }
        steps.end("before the program is written");
        let ((), emitted) = run_beside(
            &self.beside_runner(),
            move || {
                let mut steps = StepClock::new(Stage::LinkAndEmit, "emit, beside the writing");
                for session in sessions {
                    session.drop_in_parallel(&runner_of_drops);
                }
                steps.end("the sessions are dropped");
            },
            || match body_placement {
                BodyPlacement::InProgramBytes => {
                    put_function_texts_into(&mut program, &output.texts);
                    program.functions = body_remap.into_program_functions(&in_parallel);
                    emit_from(&mut program, &in_parallel)
                }
                BodyPlacement::External => {
                    if writes_program_file {
                        put_function_texts_into(&mut program, &output.texts);
                    }
                    emit_with_external_bodies(&mut program, body_remap, &in_parallel)
                }
            },
        );
        steps.end("the program is written, the sessions are dropped");
        self.leftovers.push(Box::new(program));
        drop_thread_caches(self.caches);
        steps.end("the threads' caches are dropped");
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
        let Some(path) = program_file_path(self.options) else {
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
        // The pool has as many threads as there was source text of the program's own to read. The engine fits its threads to the program that
        // it gets, of which Bun's own code may be the larger part: the lowest layer of a test run holds all of it.
        if self.options.aot.thread_count.is_none() {
            bun_sema_driver::allow_threads(self.options.thread_count());
        }
        let leftovers = core::mem::take(&mut self.leftovers);
        let started = Instant::now();
        let has_ended_behind_flow_analysis = AtomicBool::new(false);
        // It serves the loads that follow. Where none can, it goes while the engine goes on.
        let mut shared_by_loads = Guarded::new(SharedByLoads::take());
        let ((), engine) = run_beside(
            &self.beside_runner(),
            move || drop(leftovers),
            || {
                engine::compile(bytes, engine_options, &output.texts, &|found| {
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
        log_unseen_code(&engine);
        self.statistics.add_values(engine.statistics());
        self.diagnostics.add_engine_records(
            &engine,
            &output.names,
            &output.texts,
            self.options.aot.runs_tests,
        );
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

    pub(crate) fn stop_if_errors(&mut self, stage: Stage) -> Result<(), Stage> {
        let options = self.options;
        self.diagnostics
            .forget_errors_in(&options.load.left_to_loader);
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
        let options = self.options;
        self.diagnostics
            .forget_errors_in(&options.load.left_to_loader);
        let refused_entry_points = self.find_refused_entry_points();
        let left_to_loader = self.find_files_to_leave_to_loader();
        let loads_below_files_left_to_loader = self.find_loads_below(&left_to_loader);
        if refused_entry_points.is_some() && self.holds_files_for_programs_above() {
            self.forget_errors_that_loader_reports();
        }
        self.clock.add_to(&mut self.statistics);
        match result {
            Ok(value) => {
                self.diagnostics.write_to(log);
                Ok((value, self.statistics))
            }
            Err(stage) => Err(BuildFailed {
                left_to_loader,
                loads_below_files_left_to_loader,
                ..fail(
                    stage,
                    self.diagnostics,
                    self.statistics,
                    refused_entry_points,
                    log,
                )
            }),
        }
    }
}
