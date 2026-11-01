use super::import_graph::ImportGraph;
use super::runtime_reach::ReachWhileLoading;
use super::{
    Build, LoadedBuild, LoadedProject, Options, ProgramsOfOneLoad, StartedWorkers,
    begins_program_at_each_entry_point, find_further_worker_files, joins_workers, library_code_of,
    mentions_worker_constructor, options_with_worker_files, preload_of,
};
use crate::builtins::table::{self, Mutability};
use crate::builtins::{BuiltinNames, RuntimeUses};
use crate::diagnostic_codes::Code;
use crate::diagnostics::{Diagnostic, Diagnostics, InternalError, LoadMessages, ProgramView};
use crate::ir::parallel::InParallel;
use crate::link::run_beside;
use crate::load::fold_inputs::{
    ProgramFacts, create_application_fold_inputs, create_runtime_fold_inputs,
};
use crate::load::host::{LoadHost, LoadHostInput, create_disk};
use crate::load::is_in_archive_of_bun;
use crate::load::loaders::{loader_named_by_path, script_kind_of};
use crate::load::named_loads::{
    leave_named_library_modules_to_loader, resolve_loads_through_imported_loaders,
};
use crate::load::replaced_modules::packages_mock_modules_that_they_do_not_spell;
use crate::load::runtime_host::RuntimeHost;
use crate::load::runtime_modules::RuntimeModules;
use crate::load::runtime_roots::{
    FurtherLibraryCode, RuntimeRoots, collect_runtime_roots, join_asks, join_root_paths,
};
use crate::load::source_provider::SourceFile;
use crate::load::sources::{
    FreezeInput, FrozenSources, check_unique_paths_across_projects, freeze_sources, parsed_source,
};
use crate::load::worker_files::{
    SearchedFrom, SomeFilesOf, WorkerFile, WorkerSearch, find_code_that_starts_workers,
    find_embedded_code_files, source_path_of,
};
use crate::load::{PerProject, ProjectId, SourceKind, Sources};
use crate::options::{LoadOptions, PathOptions};
use crate::statistics::{
    LimitId, LimitValues, Stage, StatisticId, Statistics, log_why_files_are_loaded_again,
};
use bun_ast::Loader;
use bun_builtin_sources::{Archive, Manifest, VIRTUAL_ROOT};
use bun_sema::atom::Interner;
use bun_sema::check::aot::FileOrigin;
use bun_sema::fold::FoldInputs;
use bun_sema::import_sites::ImportSpecifier;
use bun_sema::program::{CodeView, FileId, Files, MainModule, Run};
use bun_sema::resolve::{CodeHost, CodeOptions, is_declaration_file_name};
use bun_sema::session::{Session, SessionSlot};
use bun_sema::util::{FxHashSet, SharedSort};
use bun_sema_driver::host::Disk;
use bun_sema_driver::{
    ChosenThreads, CompileRequest, EntryPoints, FileFinder, FileFinderTables, LoadFailure,
    LoadedProgram, find_configuration_of_each_entry_point, fit_threads_to_sources,
    load_program_with_parsed_files, resolve_names_known_in_part,
};
use bun_threading::Guarded;
use core::sync::atomic::Ordering;
use std::borrow::Cow;
use std::cell::{Cell, OnceCell, RefCell};
use std::mem::take;
use std::sync::Arc;
#[cfg(any(test, feature = "test_support"))]
use std::sync::OnceLock;
use std::thread::Scope;
use std::time::Instant;

const MAX_ASSET_READERS: usize = 64;

/// What plugins make of the assets is needed when the executable is written. A plugin can take seconds for one.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum AssetReads {
    #[cfg(test)]
    FinishedByLoad,
    /// They go on while `then` runs, which calls `LoadedBuild::finish_asset_reads`.
    FinishedLater,
}

type Then<'t, 'a, R> =
    &'t mut dyn for<'b, 's> FnMut(&mut Build<'a>, LoadedBuild<'b, 's>) -> Result<R, Stage>;

// Each reader starts the next: the calling thread pays for one thread.
fn start_asset_readers<'scope>(
    scope: &'scope Scope<'scope, '_>,
    host: &'scope LoadHost<'_>,
    paths: std::sync::Arc<Guarded<Vec<Vec<u8>>>>,
    count: usize,
) {
    if count == 0 {
        return;
    }
    let thread = std::thread::Builder::new()
        .stack_size(bun_threading::thread_pool::DEFAULT_THREAD_STACK_SIZE as usize);
    let _ = thread.spawn_scoped(scope, move || {
        bun_core::Output::Source::configure_named_thread(bun_core::zstr!("Plugin"));
        start_asset_readers(scope, host, std::sync::Arc::clone(&paths), count - 1);
        loop {
            let Some(path) = paths.lock().pop() else {
                return;
            };
            host.read_in_background(&path);
        }
    });
}

fn read_assets<'scope>(scope: &'scope Scope<'scope, '_>, host: &'scope LoadHost<'_>) {
    let paths = host.background_reads();
    let count = paths.len().min(MAX_ASSET_READERS);
    start_asset_readers(scope, host, std::sync::Arc::new(Guarded::new(paths)), count);
}

/// The locked members of built-in objects that files of a test run replace and that the load does not know of.
fn find_replaced_builtins_spelled(options: &Options<'_>, files: &Files<'_>) -> Vec<u32> {
    if !is_test_run(options) {
        return Vec::new();
    }
    if crate::statistics::logs_stages() {
        for &file in files.compiled_files() {
            let members = parsed_source(files, file).map(|it| it.builtins.replaced_members());
            let members: Vec<String> = (members.unwrap_or_default().iter())
                .map(|&member| table::text_of(member))
                .collect();
            if !members.is_empty() {
                bun_core::print_errorln!(
                    "AOT test run | {} replaces: {}",
                    bstr::BStr::new(files.module(file).file_name()),
                    members.join(" "),
                );
            }
        }
    }
    let sources = files.compiled_files().iter();
    let sources = sources.filter_map(|&file| parsed_source(files, file));
    let known = &options.load.replaced_builtins;
    let mut spelled: Vec<u32> = sources
        .flat_map(|source| source.builtins.replaced_members().iter())
        .filter(|&&member| table::entry(member).mutability == Mutability::AlwaysLocked)
        .map(|&member| member as u32)
        .filter(|member| known.binary_search(member).is_err())
        .collect();
    spelled.shared_sort_unstable();
    spelled.dedup();
    spelled
}

struct ApplicationLoad<'l, 'scope, 'env, 'h, 's> {
    host: &'scope LoadHost<'h>,
    request: &'l CompileRequest<'l, 's>,
    scope: &'scope Scope<'scope, 'env>,
    asset_reads: AssetReads,
    finish_asset_reads: &'l dyn Fn() -> bool,
    /// Of a build of several programs: for each entry point of the request the position of its program among `Build::programs`.
    positions: &'l [usize],
}

/// The files that earlier loads have parsed.
#[derive(Copy, Clone)]
enum ParsedBefore<'s> {
    Nothing,
    ByThisBuild(&'s Run<'s>),
    /// In a session that outlives those of the load.
    ByEarlierLoads(&'s Run<'static>),
}

impl<'s> ParsedBefore<'s> {
    fn load_program(
        self,
        session: &'s Session,
        host: &dyn CodeHost,
        request: &CompileRequest<'_, 's>,
    ) -> Result<LoadedProgram<'s>, LoadFailure> {
        match self {
            ParsedBefore::Nothing => load_program_with_parsed_files(session, host, request, None),
            ParsedBefore::ByThisBuild(parsed) => {
                load_program_with_parsed_files(session, host, request, Some(parsed))
            }
            ParsedBefore::ByEarlierLoads(parsed) => {
                load_program_with_parsed_files(session, host, request, Some(parsed))
            }
        }
    }
}

/// A build loads once for each time that a program is compiled again, and once for each program that is loaded by itself. What a load
/// reads out of the archive of Bun is parsed and bound for the first.
pub(super) struct SharedByLoads {
    parsed: Run<'static>,
    atoms: Interner<'static>,
    /// Behind the two, which borrow it.
    session: Box<Session>,
}

thread_local! {
    /// `Some`: `compile` runs on this thread. The loads of a build run on the thread that called it.
    static SHARED_BY_LOADS: RefCell<Option<Option<Arc<SharedByLoads>>>> = const { RefCell::new(None) };
}

impl SharedByLoads {
    fn new() -> SharedByLoads {
        let session = Box::new(Session::new());
        // SAFETY: the session stays where it is and outlives `parsed` and `atoms`, and both are handed out only for as long as `self` is borrowed.
        let borrowed: &'static Session =
            unsafe { &*std::ptr::from_ref::<Session>(session.as_ref()) };
        let atoms = Interner::new_in(borrowed);
        SharedByLoads {
            parsed: Run::of_compile_builds(borrowed, atoms, is_in_archive_of_bun),
            atoms,
            session,
        }
    }

    pub(super) fn begin_build() {
        SHARED_BY_LOADS.set(Some(None));
    }

    pub(super) fn end_build() {
        SHARED_BY_LOADS.set(None);
    }

    /// Whoever takes it decides whether a further load finds it: see `keep`.
    pub(super) fn take() -> Option<Arc<SharedByLoads>> {
        SHARED_BY_LOADS.with_borrow_mut(|of_build| of_build.as_mut()?.take())
    }

    pub(super) fn keep(shared: Arc<SharedByLoads>) {
        SHARED_BY_LOADS.with_borrow_mut(|of_build| {
            if let Some(kept) = of_build {
                *kept = Some(shared);
            }
        });
    }

    /// For whoever drops the sessions of a load. `None`: a load still reads it.
    pub(super) fn into_session(shared: Arc<SharedByLoads>) -> Option<Session> {
        let SharedByLoads {
            parsed, session, ..
        } = Arc::into_inner(shared)?;
        drop(parsed);
        Some(*session)
    }

    fn of_running_build(options: &Options<'_>) -> Option<Arc<SharedByLoads>> {
        if preload_of(options).is_some() {
            return None;
        }
        SHARED_BY_LOADS.with_borrow_mut(|of_build| {
            let kept = of_build.as_mut()?;
            let shared = kept.get_or_insert_with(|| Arc::new(SharedByLoads::new()));
            Some(Arc::clone(shared))
        })
    }
}

/// A test program builds thousands of small programs. What each reads out of the archive of Bun is parsed and bound for the first.
#[cfg(any(test, feature = "test_support"))]
struct SharedByBuilds {
    atoms: Interner<'static>,
    parsed: Run<'static>,
}

#[cfg(any(test, feature = "test_support"))]
impl SharedByBuilds {
    fn of_test_program() -> &'static SharedByBuilds {
        static SESSION: OnceLock<Session> = OnceLock::new();
        static SHARED: OnceLock<SharedByBuilds> = OnceLock::new();
        SHARED.get_or_init(|| {
            let session = SESSION.get_or_init(Session::new);
            let atoms = Interner::new_in(session);
            SharedByBuilds {
                atoms,
                parsed: Run::of_compile_builds(session, atoms, is_in_archive_of_bun),
            }
        })
    }

    fn serves(options: &Options<'_>) -> bool {
        let mut own_texts = options.load.in_memory_files.iter();
        preload_of(options).is_none() && !own_texts.any(|(path, _)| is_in_archive_of_bun(path))
    }
}

struct SharedLoadInputs<'c, 's> {
    disk: &'c Disk,
    sessions: PerProject<&'s Session>,
    world_sessions: &'s [SessionSlot],
    /// One for each load of Bun's own code behind the first.
    further_runtime_sessions: &'s [Session],
    atoms: Interner<'s>,
    application_fold: &'c FoldInputs<'s>,
    builtin_names: &'c BuiltinNames,
    manifest: &'static Manifest,
    runtime_modules: &'c RuntimeModules,
    messages: &'c LoadMessages,
    parsed_before: ParsedBefore<'s>,
}

/// What the request for a load of Bun's own code borrows.
struct RuntimeLoadInputs<'c, 's> {
    fold: FoldInputs<'s>,
    code: CodeOptions,
    host: RuntimeHost<'c>,
    can_load_code_at_run_time: bool,
    loads_code_by_unknown_names_alone: bool,
}

// Programs that ask the same of Bun's own code share one load of it. So do programs that ask for functions of the language alone, which
// stand in files that declare nothing for other files: each holds what it reaches of them.
fn asks_the_same(a: &RuntimeRoots, b: &RuntimeRoots) -> bool {
    let ask_for_the_language_alone = !a.asks.has_code_of_host() && !b.asks.has_code_of_host();
    (a.paths == b.paths || ask_for_the_language_alone)
        && a.host_loaded_modules == b.host_loaded_modules
        && a.modules_named_at_run_time == b.modules_named_at_run_time
        && a.imports_cluster == b.imports_cluster
        && a.imports_uncompiled_code == b.imports_uncompiled_code
        && a.loads_by_unknown_path == b.loads_by_unknown_path
        && a.keeps_code_without_names == b.keeps_code_without_names
        && a.holds_guessed_code == b.holds_guessed_code
}

fn create_runtime_modules(archive: &'static Archive, options: &Options<'_>) -> RuntimeModules {
    let runtime_modules = RuntimeModules::new(archive, options.load.omits_builtin_modules)
        .with_test_aliases(options.load.runs_tests);
    #[cfg(test)]
    let runtime_modules = runtime_modules.with_replaced_sources(&options.load.in_memory_files);
    runtime_modules
}

impl<'a> Build<'a> {
    #[cfg(test)]
    pub(crate) fn with_loaded_projects<R>(
        &mut self,
        then: impl for<'b, 's> FnOnce(&mut Build<'a>, LoadedBuild<'b, 's>) -> Result<R, Stage>,
    ) -> Result<R, Stage> {
        let mut then = Some(then);
        self.load_in_new_sessions(AssetReads::FinishedByLoad, &mut |build, loaded| {
            (then.take().expect("the program is loaded once"))(build, loaded)
        })
    }

    pub(super) fn load_in_new_sessions<R>(
        &mut self,
        asset_reads: AssetReads,
        then: Then<'_, 'a, R>,
    ) -> Result<R, Stage> {
        let sessions = PerProject {
            application: Session::new(),
            runtime: Session::new(),
        };
        let world_sessions: Vec<SessionSlot> = (0..64).map(|_| SessionSlot::new()).collect();
        let program_count = self.programs.map_or(1, |programs| programs.indexes.len());
        let further: Vec<Session> = (1..program_count).map(|_| Session::new()).collect();
        let all = (sessions.as_ref(), &world_sessions[..], &further[..]);
        let result = self.load_in_sessions(all, asset_reads, then);
        self.retired_sessions
            .extend([sessions.application, sessions.runtime]);
        let world_sessions = world_sessions.into_iter().map(SessionSlot::into_session);
        let others = world_sessions.chain(further);
        self.retired_sessions
            .extend(others.filter(|session| !session.is_unused()));
        result
    }

    fn load_in_sessions<R>(
        &mut self,
        (sessions, world_sessions, further_runtime_sessions): (
            PerProject<&Session>,
            &[SessionSlot],
            &[Session],
        ),
        asset_reads: AssetReads,
        then: Then<'_, 'a, R>,
    ) -> Result<R, Stage> {
        self.clock.start(Stage::Load);
        let options = self.options;
        self.chosen_threads = match options.aot.thread_count {
            None => {
                fit_threads_to_sources();
                None
            }
            Some(_) => Some(ChosenThreads::new(self.threads)),
        };
        let disk = create_disk(options, self.threads);
        let application_session = sessions.application;
        let shared_by_loads = SharedByLoads::of_running_build(options);
        let atoms = match &shared_by_loads {
            Some(shared) => shared.atoms.for_files_of(application_session),
            None => Interner::new_in(application_session),
        };
        #[cfg(any(test, feature = "test_support"))]
        let shared_by_builds =
            SharedByBuilds::serves(options).then(SharedByBuilds::of_test_program);
        #[cfg(any(test, feature = "test_support"))]
        let atoms = shared_by_builds.map_or(atoms, |shared| {
            shared.atoms.for_files_of(application_session)
        });
        debug_assert!(core::ptr::eq(atoms.session(), application_session));
        let builtin_names = BuiltinNames::new(&atoms);
        let archive = Archive::embedded();
        let runtime_modules = create_runtime_modules(archive, options);
        let messages = LoadMessages::default();
        let provided = messages.with_log(|log| {
            self.provider
                .fold_options(application_session.arena(), &atoms, log)
        });
        let application_fold = create_application_fold_inputs(
            &provided,
            application_session.arena(),
            &atoms,
            &self.limits,
            self.platform,
            options.aot.runs_in_place,
            &options.load.replaced_builtins,
        );
        let parsed_before = match (preload_of(options), &shared_by_loads) {
            (None, None) => ParsedBefore::Nothing,
            (None, Some(shared)) => ParsedBefore::ByEarlierLoads(&shared.parsed),
            (Some(_), _) => ParsedBefore::ByThisBuild(
                (application_session.arena())
                    .alloc(Run::of_compile_build(application_session, atoms)),
            ),
        };
        #[cfg(any(test, feature = "test_support"))]
        let parsed_before = shared_by_builds.map_or(parsed_before, |shared| {
            ParsedBefore::ByEarlierLoads(&shared.parsed)
        });
        let shared = SharedLoadInputs {
            disk: &disk,
            sessions,
            world_sessions,
            further_runtime_sessions,
            atoms,
            application_fold: &application_fold,
            builtin_names: &builtin_names,
            manifest: archive.manifest(),
            runtime_modules: &runtime_modules,
            messages: &messages,
            parsed_before,
        };
        let parses_before = shared_by_loads.as_ref().map(|it| it.parsed.parses());
        let result = self.load_projects(&shared, asset_reads, then);
        if let (Some(shared), Some(before)) = (&shared_by_loads, parses_before) {
            let parses = (shared.parsed.parses() - before) as u64;
            (self.statistics).count(StatisticId::SourceFilesOfBunParsed, parses);
        }
        self.leftovers.push(Box::new(disk));
        result
    }

    fn load_projects<R>(
        &mut self,
        shared: &SharedLoadInputs<'_, '_>,
        asset_reads: AssetReads,
        then: Then<'_, 'a, R>,
    ) -> Result<R, Stage> {
        let options = self.options;
        let code = CodeOptions {
            mocks_any_file: options.load.mocks_any_module || options.load.runs_tests,
            ..options.code.clone()
        };
        let limits = self.limits.clone();
        let host = LoadHost::new(LoadHostInput {
            disk: shared.disk,
            provider: self.provider,
            options,
            runtime_modules: shared.runtime_modules,
            messages: shared.messages,
            builtin_names: shared.builtin_names,
            platform: self.platform,
            limits: &limits,
        });
        let host = match asset_reads {
            #[cfg(test)]
            AssetReads::FinishedByLoad => host,
            AssetReads::FinishedLater => host.reading_in_background_after_load(),
        };
        let stores_path_of_main_module = options.load.stores_path_of_main_module;
        let written_for_programs = |entry_points| {
            let main_module = match stores_path_of_main_module {
                true => MainModule::AnyFile,
                false => MainModule::EntryPointOfProcessOrWorker,
            };
            EntryPoints::WrittenFor(entry_points, main_module)
        };
        let request = CompileRequest {
            entry_points: match self.programs {
                None if !stores_path_of_main_module => EntryPoints::Written(&options.entry_points),
                None | Some(_) => written_for_programs(&options.entry_points),
            },
            code: &code,
            fold: shared.application_fold,
            atoms: shared.atoms,
            libs: options.typescript_libs,
            project_origin: match options.aot.runs_tests && !options.aot.checks_only {
                true => FileOrigin::TestedSource,
                false => FileOrigin::NoFile,
            },
            threads: self.threads,
            progress: None,
            left_out_bodies: None,
        };
        // A program is configured by the file that its entry point finds. Those that find the one of the first are loaded with it.
        let positions = self.leave_entry_points_of_other_projects(&host, &request);
        let loaded_entry_points: Vec<Vec<u8>> = (positions.iter())
            .map(|&position| options.entry_points[position].clone())
            .collect();
        let request = match positions.len() == options.entry_points.len() {
            true => request,
            false => CompileRequest {
                entry_points: written_for_programs(&loaded_entry_points),
                ..request
            },
        };
        let left_before_load = self.left_entry_points.len();
        let result = std::thread::scope(|scope| {
            loop {
                self.options = options;
                self.left_entry_points.truncate(left_before_load);
                let are_assets = Cell::new(None);
                let finish_asset_reads = || {
                    let finish = || host.finish_background_reads() || shared.messages.has_errors();
                    let finished = are_assets.get().unwrap_or_else(finish);
                    are_assets.set(Some(finished));
                    finished
                };
                let project = ApplicationLoad {
                    host: &host,
                    request: &request,
                    scope,
                    asset_reads,
                    finish_asset_reads: &finish_asset_reads,
                    positions: &positions,
                };
                let result = self.load_projects_once(shared, &project, then);
                if finish_asset_reads() {
                    if asset_reads == AssetReads::FinishedLater {
                        self.diagnostics.add_load_messages(shared.messages);
                    }
                    let from_plugins = host.assets_from_plugins();
                    let from_plugins: Vec<Vec<u8>> = from_plugins
                        .iter()
                        .map(|path| source_path_of(path))
                        .collect();
                    self.started_workers.remove_sources(&from_plugins);
                    return result;
                }
                drop(result);
                log_why_files_are_loaded_again(format_args!(
                    "a file that was read behind the load is not what the load took it for"
                ));
                self.provider.clear_embedded_files();
                self.diagnostics = Diagnostics::new();
                self.statistics = Statistics::default();
            }
        });
        self.leftovers.push(host.into_leftovers());
        result
    }

    fn load_projects_once<'s, R>(
        &mut self,
        shared: &SharedLoadInputs<'_, 's>,
        project: &ApplicationLoad<'_, '_, '_, '_, 's>,
        then: Then<'_, 'a, R>,
    ) -> Result<R, Stage> {
        let mut kept_runtime = None;
        if let Some(preload) = preload_of(self.options) {
            let placeholder = [preload.placeholder_entry_point.to_vec()];
            let request = CompileRequest {
                entry_points: EntryPoints::Written(&placeholder),
                ..*project.request
            };
            let of_placeholder = ApplicationLoad {
                host: project.host,
                request: &request,
                scope: project.scope,
                asset_reads: project.asset_reads,
                finish_asset_reads: project.finish_asset_reads,
                positions: project.positions,
            };
            self.is_preloading = true;
            let compiled =
                self.load_and_compile(shared, &of_placeholder, &mut *then, &mut kept_runtime);
            self.is_preloading = false;
            drop(compiled?);
            self.diagnostics = Diagnostics::new();
            self.statistics = Statistics::default();
            self.clock.start(Stage::Load);
            preload.is_loaded.store(true, Ordering::Relaxed);
            (preload.on_loaded)();
        }
        self.load_and_compile(shared, project, then, &mut kept_runtime)
    }

    /// What of Bun's own code the load holds beside what the files name.
    pub(super) fn library_code_asked_for(&self, load: &LoadOptions) -> RuntimeUses {
        library_code_of(&load.library_code_lacked)
    }

    /// `kept_runtime`: Bun's own code as an earlier program of the build has loaded it. The placeholder of `Preload` leaves it there.
    fn load_and_compile<'s, R>(
        &mut self,
        shared: &SharedLoadInputs<'_, 's>,
        project: &ApplicationLoad<'_, '_, '_, '_, 's>,
        then: Then<'_, 'a, R>,
        kept_runtime: &mut Option<(RuntimeRoots, LoadedProgram<'s>)>,
    ) -> Result<R, Stage> {
        let options = self.options;
        let (host, request) = (project.host, project.request);
        let session = shared.sessions.application;
        let is_held_below = |path: &[u8]| options.aot.images_below.holds_module(path);
        let code_from_root = CodeOptions {
            working_directory: bun_sema_driver::host::from_native(&options.paths.root_directory),
            ..request.code.clone()
        };
        let limits = self.limits.clone();
        let parameters_below = &options.aot.replaced_by_tests.parameters_that_start_workers;
        let provider = self.provider;
        // One resolver for each search, made at its first question. Not one for all: between two searches the host is told to leave other files alone.
        let is_built_upon = options.aot.shares_realms && !options.aot.is_part_of_test_files;
        let find_code = |files: &dyn CodeView<'_>,
                         (paths, is_built_upon): (&PathOptions, bool),
                         in_parallel: InParallel<'_>| {
            let tables = [FileFinderTables::default(), FileFinderTables::default()];
            let finders = [OnceCell::new(), OnceCell::new()];
            let from_here =
                || finders[0].get_or_init(|| FileFinder::new(&tables[0], host, request.code));
            let from_root =
                || finders[1].get_or_init(|| FileFinder::new(&tables[1], host, &code_from_root));
            let search = WorkerSearch {
                limits: &limits,
                loaders: &options.load.loaders,
                paths,
                runs_in_place: options.aot.runs_in_place,
                provider,
                resolve_entry_point: &|written| from_here().find_entry_point(written),
                resolve_bare_name: &|name| from_root().find_entry_point(name),
                find_files_named_in_part: &|from, names| {
                    let directory = match from {
                        SearchedFrom::FolderOf(file) => host.directory_of(file),
                        SearchedFrom::RootDirectory => {
                            Cow::Borrowed(&code_from_root.working_directory[..])
                        }
                        SearchedFrom::WorkingDirectory => {
                            Cow::Borrowed(&request.code.working_directory[..])
                        }
                    };
                    resolve_names_known_in_part(host, request.code, &directory, names)
                },
                working_directory: &request.code.working_directory,
                is_held_below: &is_held_below,
                parameters_below,
                resolve_import: &|importer, written| from_here().find_import(importer, written),
                is_built_upon,
            };
            find_code_that_starts_workers(files, &search, in_parallel)
        };
        // The files that Workers start from are entry points of the one program of such a build. The load looks for them once all its files are parsed, and goes on
        // with them: a load of everything for the search and a second one with what it found would parse every file twice.
        let known = (self.known_worker_files.as_ref())
            .filter(|_| self.takes_in_worker_files.is_some())
            .filter(|_| self.programs.is_none() && !options.aot.checks_only)
            .filter(|_| preload_of(options).is_none());
        let splits = known.is_some_and(|known| known.0);
        let left_out = known.map(|known| known.1.clone());
        let in_parallel = self.parallel_runner();
        // Each with the path that the load knows it by.
        let taken_in: Guarded<Vec<(Vec<u8>, WorkerFile)>> = Guarded::new(Vec::new());
        // The files that were searched and start no Worker themselves. A file that does is looked at again beside the new ones: a call there may hand it the file of the next Worker.
        let searched_before: Guarded<FxHashSet<Vec<u8>>> = Guarded::new(FxHashSet::default());
        let find_entry_points = |code: &dyn CodeView<'_>| -> Vec<Vec<u8>> {
            let mut taken_in = taken_in.lock();
            let known: Vec<WorkerFile> = taken_in.iter().map(|it| it.1.clone()).collect();
            let longer = options_with_worker_files(options, &known);
            let mut searched_before = searched_before.lock();
            let compiled = code.compiled_files().iter().copied();
            let some = SomeFilesOf {
                all: code,
                searched: compiled
                    .filter(|&file| !searched_before.contains(code.file_name(file)))
                    .collect(),
            };
            let found = find_code(&some, (&longer.paths, false), &in_parallel);
            let with_starts: FxHashSet<Vec<u8>> = found.files_with_starts.into_iter().collect();
            let searched = some.searched.iter().map(|&file| code.file_name(file));
            searched_before.extend(
                searched
                    .filter(|&name| !with_starts.contains(name))
                    .map(<[u8]>::to_vec),
            );
            let started = StartedWorkers {
                files: found.files,
                constructs_node_workers: found.constructs_node_workers,
                ..Default::default()
            };
            if taken_in.is_empty() && !joins_workers(splits, &started) {
                return Vec::new();
            }
            let mut entry_points: FxHashSet<Vec<u8>> = longer.entry_points.into_iter().collect();
            let loaded = code.entry_points().iter();
            entry_points.extend(loaded.map(|&first| source_path_of(code.file_name(first))));
            let left_out = left_out.as_deref().unwrap_or_default();
            let further =
                find_further_worker_files(&started, left_out, |path| entry_points.contains(path));
            let tables = FileFinderTables::default();
            let finder = FileFinder::new(&tables, host, request.code);
            // What else a Worker starts from is read in another way where it is an entry point, or is no file. The search behind the load finds it.
            let path_of = |file: &WorkerFile| {
                let loader = loader_named_by_path(&options.load.loaders, &file.source_path)?;
                let is_plain_code = script_kind_of(loader).is_some()
                    && !is_declaration_file_name(&file.source_path)
                    && file.text.is_none();
                finder
                    .find_entry_point(&file.source_path)
                    .filter(|_| is_plain_code)
            };
            let Some(paths) = further
                .iter()
                .map(path_of)
                .collect::<Option<Vec<Vec<u8>>>>()
            else {
                return Vec::new();
            };
            taken_in.extend(paths.iter().cloned().zip(further));
            let written: Vec<Vec<u8>> = (taken_in.iter())
                .map(|it| it.1.source_path.clone())
                .collect();
            host.begin_at(&written);
            paths
        };
        let written = match request.entry_points {
            EntryPoints::Written(written) => Some((written, MainModule::EntryPoint)),
            EntryPoints::WrittenFor(written, main_module) => Some((written, main_module)),
            _ => None,
        };
        let request_that_finds = written.filter(|_| left_out.is_some()).map(|written| {
            let entry_points =
                EntryPoints::WrittenAndFound(written.0, written.1, &find_entry_points);
            CompileRequest {
                entry_points,
                ..*request
            }
        });
        host.begin_at(&[]);
        let loaded = request_that_finds.as_ref().unwrap_or(request);
        let application = match self.load_application(session, host, loaded, shared) {
            Ok(application) => application,
            Err(stage) => {
                // A build that is given them says what is wrong with them as it always has.
                let taken_in = taken_in.lock();
                self.files_of_the_one_program = taken_in.iter().map(|it| it.1.clone()).collect();
                return Err(stage);
            }
        };
        let found = written.map_or(&[][..], |written| {
            let entry_points = application.files().entry_points();
            entry_points.get(written.0.len()..).unwrap_or_default()
        });
        let taken_in: Vec<WorkerFile> = {
            let taken_in = taken_in.lock();
            let path_of = |&first: &FileId| application.files().module(first).file_name();
            let file_at = |path: &[u8]| taken_in.iter().find(|it| it.0 == path);
            let files = found.iter().filter_map(|first| file_at(path_of(first)));
            files.map(|it| it.1.clone()).collect()
        };
        if taken_in.len() != found.len() {
            self.took_in_too_much = true;
            return Err(Stage::Load);
        }
        if !taken_in.is_empty() && crate::statistics::logs_stages() {
            bun_core::print_errorln!(
                "AOT load goes on | with {} more files that Workers start from",
                taken_in.len()
            );
        }
        let options = match (self.takes_in_worker_files, taken_in.is_empty()) {
            (Some(grows), false) => grows.take_in(&taken_in),
            _ => options,
        };
        self.options = options;
        // They are in the one program of the build, and so is whatever else a Worker starts from.
        if let Some(known) = (self.known_worker_files.as_mut()).filter(|_| !taken_in.is_empty()) {
            known.0 = false;
        }
        let all_positions: Vec<usize> = (0..options.entry_points.len()).collect();
        let request_for_all = CompileRequest {
            entry_points: match request.entry_points {
                EntryPoints::WrittenFor(_, main_module) => {
                    EntryPoints::WrittenFor(&options.entry_points, main_module)
                }
                _ => EntryPoints::Written(&options.entry_points),
            },
            ..*request
        };
        let project_of_all = ApplicationLoad {
            host,
            request: &request_for_all,
            scope: project.scope,
            asset_reads: project.asset_reads,
            finish_asset_reads: project.finish_asset_reads,
            positions: &all_positions,
        };
        let project = match taken_in.is_empty() {
            true => project,
            false => &project_of_all,
        };
        let request = project.request;
        if project.asset_reads == AssetReads::FinishedLater {
            read_assets(project.scope, host);
        }
        let is_joined = self.programs.is_some_and(|programs| programs.is_joined);
        // Whoever started the build of a part is told which of its test files do not run, be it the only one.
        self.names_refused_entry_points =
            (options.aot.checks_only || options.aot.runs_tests || is_joined)
                && (options.entry_points.len() > 1 || options.aot.is_part_of_test_files);
        // `find_files_to_leave_to_loader`: what such a file loads is known here for the last time.
        if self.names_refused_entry_points
            || options.load.runs_tests
            || ImportGraph::holds_files_that_no_site_spells(application.files())
        {
            self.import_graph = Some(ImportGraph::of(application.files()));
        }
        match options.aot.imports_are_in_other_images {
            true => leave_named_library_modules_to_loader(application.files()),
            false => {
                resolve_loads_through_imported_loaders(application.files(), &self.parallel_runner())
            }
        }

        let files = application.files();
        self.started_workers = Default::default();
        if !options.aot.checks_only {
            self.started_workers.copies = find_embedded_code_files(
                files,
                &options.load.loaders,
                &is_held_below,
                &self.parallel_runner(),
            );
        }
        let mut files_with_starts: FxHashSet<Vec<u8>> = FxHashSet::default();
        // A file that names no constructor starts a Worker too, where it calls a function of a program below that does.
        if !options.aot.checks_only
            && (mentions_worker_constructor(files) || !parameters_below.is_empty())
        {
            let asked = (&options.paths, is_built_upon);
            let found = find_code(files, asked, &self.parallel_runner());
            files_with_starts.extend(found.files_with_starts);
            self.replaced_builtins.parameters_that_start_workers = found.parameters;
            self.started_workers.files = found.files;
            self.started_workers.names = found.names;
            self.started_workers.code = found.code;
            self.started_workers.constructs_node_workers = found.constructs_node_workers;
        }
        let is_started = |file: &WorkerFile| {
            let mut started = self.started_workers.files.iter();
            started.any(|it| it.source_path == file.source_path)
        };
        if !taken_in.iter().all(is_started) {
            self.took_in_too_much = true;
            return Err(Stage::Load);
        }
        if let Some((splits, left_out)) = &self.known_worker_files
            && joins_workers(*splits, &self.started_workers)
        {
            // A text that a Worker starts from is an entry point under the name that the build has given it.
            let mut entry_points: FxHashSet<Vec<u8>> =
                options.entry_points.iter().cloned().collect();
            let loaded = files.entry_points().iter();
            entry_points
                .extend(loaded.map(|&first| source_path_of(files.module(first).file_name())));
            self.files_of_the_one_program =
                find_further_worker_files(&self.started_workers, left_out, |path| {
                    entry_points.contains(path)
                });
            // The build starts over with them. Nothing but the load is thrown away.
            if !self.files_of_the_one_program.is_empty() {
                // The next load takes both in.
                self.replaced_builtins_spelled = find_replaced_builtins_spelled(options, files);
                // A file that a Worker starts from may start Workers too, and each find costs a load of all files. So what the files
                // just found name is looked for at once, in loads of them and of what they alone import. What such a look misses the next
                // load of all files finds.
                let name_of =
                    |files: &Files<'_>, file: FileId| files.module(file).file_name().to_vec();
                let loaded = files.compiled_files().iter();
                // A file that starts Workers is looked at again beside the new ones: a call there may hand it the file of the next Worker.
                let mut held: FxHashSet<Vec<u8>> = (loaded.map(|&file| name_of(files, file)))
                    .filter(|name| !files_with_starts.contains(name))
                    .collect();
                let mut newest = self.files_of_the_one_program.clone();
                // The search asks for no type, and the files that a project lists for their types are most of a load.
                let code_of_few_files = CodeOptions {
                    types_stop_at_entry_points: true,
                    ..request.code.clone()
                };
                loop {
                    entry_points.extend(newest.iter().map(|file| file.source_path.clone()));
                    let named = newest.iter().filter(|file| file.text.is_none());
                    let paths: Vec<Vec<u8>> = named
                        .map(|file| bun_sema_driver::host::from_native(&file.source_path))
                        .collect();
                    if paths.is_empty() {
                        break;
                    }
                    host.leave_alone(held.clone());
                    let further = CompileRequest {
                        entry_points: EntryPoints::Resolved(&paths),
                        code: &code_of_few_files,
                        fold: request.fold,
                        atoms: request.atoms,
                        libs: request.libs,
                        project_origin: request.project_origin,
                        threads: request.threads,
                        progress: request.progress,
                        left_out_bodies: request.left_out_bodies,
                    };
                    let Ok(further) = shared.parsed_before.load_program(session, host, &further)
                    else {
                        break;
                    };
                    let files = further.files();
                    let asked = (&options.paths, is_built_upon);
                    let found = find_code(files, asked, &self.parallel_runner());
                    files_with_starts.extend(found.files_with_starts);
                    let started = StartedWorkers {
                        files: found.files,
                        ..Default::default()
                    };
                    newest = find_further_worker_files(&started, left_out, |path| {
                        entry_points.contains(path)
                    });
                    let loaded = files.compiled_files().iter();
                    let loaded = loaded.map(|&file| name_of(files, file));
                    held.extend(loaded.filter(|name| !files_with_starts.contains(name)));
                    self.files_of_the_one_program.extend(newest.iter().cloned());
                }
                host.leave_alone(FxHashSet::default());
                log_why_files_are_loaded_again(format_args!(
                    "with {} more files that Workers start from",
                    self.files_of_the_one_program.len()
                ));
                return Err(Stage::Load);
            }
        }
        if !self.started_workers.copies.is_empty() || !self.started_workers.files.is_empty() {
            self.started_workers.held_texts = texts_of_program_files(files)
                .map(|(path, size)| (path.to_vec(), size))
                .collect();
        }
        self.compile_loaded(shared, project, application, then, kept_runtime)
    }

    fn compile_loaded<'s, R>(
        &mut self,
        shared: &SharedLoadInputs<'_, 's>,
        project: &ApplicationLoad<'_, '_, '_, '_, 's>,
        mut application: LoadedProgram<'s>,
        then: Then<'_, 'a, R>,
        kept_runtime: &mut Option<(RuntimeRoots, LoadedProgram<'s>)>,
    ) -> Result<R, Stage> {
        let options = self.options;
        let (host, request, positions) = (project.host, project.request, project.positions);
        let files = application.files();
        // Every file was resolved as if they were locked.
        self.replaced_builtins_spelled = find_replaced_builtins_spelled(options, files);
        // Every file was bound as if no mock could reach it.
        self.packages_mock_any_module = is_test_run(options)
            && !options.load.mocks_any_module
            && packages_mock_modules_that_they_do_not_spell(files);
        if !self.replaced_builtins_spelled.is_empty() || self.packages_mock_any_module {
            return Err(Stage::Load);
        }
        let view = |first: Option<FileId>| {
            // SAFETY: the load has ended, and between two programs no thread works for the build.
            unsafe { files.view_program(first) };
        };
        // Each program with its position and the file it begins at. A build of one program looks at all that was loaded.
        let programs: Vec<(usize, Option<FileId>)> = match self.programs {
            None => {
                if begins_program_at_each_entry_point(options)
                    && has_too_many_entry_points(files, &self.limits)
                    && (options.aot.separates_programs
                        || !are_one_program(
                            files,
                            true,
                            self.started_workers.constructs_node_workers,
                            &self.limits,
                            &mut self.statistics,
                        ))
                {
                    self.warn_about_joined_programs(files);
                }
                vec![(0, None)]
            }
            Some(ProgramsOfOneLoad {
                held_elsewhere: Some(held),
                indexes,
                is_joined,
                ..
            }) => {
                let most = self.limits.get(LimitId::MaxProgramsPerBuild);
                if indexes[0] as u64 >= most || repeats_much_text(files, held, &self.limits) {
                    log_why_files_are_loaded_again(format_args!(
                        "as one program: a program of a Worker repeats much of what others hold"
                    ));
                    self.is_one_program = true;
                    return Err(Stage::Load);
                }
                let first_files = files.entry_points().iter().copied().map(Some);
                match is_joined {
                    true => vec![(0, None)],
                    false => positions.iter().copied().zip(first_files).collect(),
                }
            }
            Some(of_one_load)
                if files.entry_points().len() != positions.len()
                    || (!self.options.aot.separates_programs
                        && (has_too_many_entry_points(files, &self.limits)
                            || are_one_program(
                                files,
                                of_one_load.indexes[positions[0]] == 0,
                                self.started_workers.constructs_node_workers,
                                &self.limits,
                                &mut self.statistics,
                            ))) =>
            {
                let holds_all = of_one_load.are_all_of_the_build
                    && of_one_load.indexes.len() == positions.len();
                if !holds_all {
                    log_why_files_are_loaded_again(format_args!(
                        "as one program: the entry points share too much, or are too many"
                    ));
                    self.is_one_program = true;
                    return Err(Stage::Load);
                }
                // What was loaded is what a build of one program loads.
                self.programs = None;
                return self.compile_loaded(shared, project, application, then, kept_runtime);
            }
            Some(_) => {
                let first_files = files.entry_points().iter().copied().map(Some);
                let programs: Vec<(usize, Option<FileId>)> =
                    positions.iter().copied().zip(first_files).collect();
                self.leave_programs_that_see_declarations_of_others(files, programs)
            }
        };
        if programs.is_empty() {
            self.has_left_all_entry_points = true;
            return Err(Stage::Load);
        }
        let is_read_again = self.programs.is_some();
        application.set_is_read_again(is_read_again);
        let first_files: Vec<Option<FileId>> = programs.iter().map(|program| program.1).collect();
        if self.programs.is_none() && crate::statistics::logs_stages() {
            let size: usize = texts_of_program_files(files).map(|(_, size)| size).sum();
            bun_core::print_errorln!(
                "AOT first look | source bytes {} | runs tests {}",
                size,
                options.load.runs_tests
            );
        }
        let mut roots: Vec<RuntimeRoots> = programs
            .iter()
            .map(|&(position, first)| {
                if first.is_some() {
                    view(first);
                }
                let of_program = self.programs.map(|all| &all.options[position].load);
                let load = of_program.unwrap_or(&options.load);
                let lacked_before = self.library_code_asked_for(load);
                let further = FurtherLibraryCode {
                    lacked_before: &lacked_before,
                    // What is loaded ahead of a program serves whatever that program asks for.
                    serves_unseen_code: load.keeps_library_code_without_names
                        || options.can_load_code_at_run_time()
                        || preload_of(options).is_some(),
                    is_served_by_other_images: options.aot.imports_are_in_other_images,
                    holds_test_files_alone: super::holds_test_files_alone(options),
                };
                collect_runtime_roots(files, shared.runtime_modules, self.platform, further)
            })
            .collect();
        let mut groups: Vec<Vec<usize>> = Vec::new();
        for (index, asked) in roots.iter().enumerate() {
            match (groups.iter_mut()).find(|group| asks_the_same(&roots[group[0]], asked)) {
                Some(group) => group.push(index),
                None => groups.push(vec![index]),
            }
        }
        let session_of = |group_index: usize| match group_index {
            0 => shared.sessions.runtime,
            _ => &shared.further_runtime_sessions[group_index - 1],
        };
        let asks: Vec<RuntimeUses> = (groups.iter())
            .map(|group| join_asks(group.iter().map(|&index| &roots[index].asks)))
            .collect();
        let inputs: Vec<RuntimeLoadInputs<'_, 's>> = (groups.iter().zip(&asks).enumerate())
            .map(|(group_index, (group, asks))| {
                // What is loaded ahead of a program serves whatever that program asks for.
                let asks = preload_of(options).is_none().then_some(asks);
                let session = session_of(group_index);
                self.create_runtime_load_inputs(shared, session, &roots[group[0]], asks)
            })
            .collect();
        let root_paths: Vec<Vec<Vec<u8>>> = (groups.iter().zip(&inputs))
            .map(|(group, inputs)| match inputs.host.reads_types {
                true => {
                    let of_group = group.iter().map(|&index| &roots[index]);
                    join_root_paths(shared.runtime_modules, of_group)
                }
                false => Vec::new(),
            })
            .collect();
        let requests: Vec<CompileRequest<'_, 's>> = (inputs.iter().zip(&root_paths))
            .map(|(inputs, root_paths)| self.create_runtime_request(shared, inputs, root_paths))
            .collect();
        // Bun's own code is loaded for all programs ahead of the other stages of any, which are thrown away where the programs are one.
        let mut loaded_ahead: Vec<Option<LoadedProgram<'s>>> = Vec::new();
        if programs.len() > 1 && !options.aot.separates_programs && kept_runtime.is_none() {
            let started = Instant::now();
            for (group_index, (inputs, request)) in inputs.iter().zip(&requests).enumerate() {
                let session = session_of(group_index);
                let runtime = self.load_runtime(shared, session, &inputs.host, request)?;
                loaded_ahead.push(Some(runtime));
            }
            self.count_time(StatisticId::LoadRuntimeProjectNanoseconds, started);
            view(None);
            let loaded = groups.iter().zip(loaded_ahead.iter().flatten());
            if repeat_much_library_text(files, loaded, &self.limits, &mut self.statistics) {
                let holds_all = self.programs.is_some_and(|of_one_load| {
                    of_one_load.are_all_of_the_build && of_one_load.indexes.len() == programs.len()
                });
                if !holds_all {
                    log_why_files_are_loaded_again(format_args!(
                        "as one program: the programs repeat much of the library"
                    ));
                    self.is_one_program = true;
                    return Err(Stage::Load);
                }
                // What was loaded of the application is what a build of one program loads.
                self.programs = None;
                return self.compile_loaded(shared, project, application, then, kept_runtime);
            }
        }
        let mut result = None;
        let mut runtime_to_keep = None;
        for (group_index, group) in groups.iter().enumerate() {
            let started = Instant::now();
            self.lowered_runtimes.begin_load();
            let roots = &roots[group[0]];
            let session = session_of(group_index);
            let runtime_request = &requests[group_index];
            let RuntimeLoadInputs {
                host: ref runtime_host,
                can_load_code_at_run_time,
                loads_code_by_unknown_names_alone,
                ..
            } = inputs[group_index];
            let loaded_ahead = loaded_ahead.get_mut(group_index).and_then(Option::take);
            let kept = kept_runtime.take();
            let kept = kept.filter(|(known, _)| asks_the_same(known, roots));
            let mut frozen_application = None;
            let mut runtime = match loaded_ahead.or_else(|| kept.map(|(_, runtime)| runtime)) {
                Some(runtime) => runtime,
                // Each of several programs has options and a view of the files of its own.
                None if self.programs.is_none() => {
                    let input = self.create_freeze_input(shared, &application, None);
                    let in_parallel = self.parallel_runner();
                    let (frozen, runtime) = run_beside(
                        &self.beside_runner(),
                        || freeze_sources(&input, &in_parallel),
                        || {
                            let parsed_before = shared.parsed_before;
                            parsed_before.load_program(session, runtime_host, runtime_request)
                        },
                    );
                    frozen_application = Some(frozen);
                    self.finish_load(runtime, runtime_request, shared.messages)?
                }
                None => self.load_runtime(shared, session, runtime_host, runtime_request)?,
            };
            self.count_time(StatisticId::LoadRuntimeProjectNanoseconds, started);

            let is_kept = matches!(shared.parsed_before, ParsedBefore::ByThisBuild(_));
            runtime.set_is_read_again(is_read_again || is_kept);
            for &index in group {
                if first_files[index].is_some() {
                    view(first_files[index]);
                }
                self.begin_program(programs[index].0);
                let programs = PerProject {
                    application: &application,
                    runtime: &runtime,
                };
                let frozen_application = frozen_application.take();
                let sources = self.freeze_projects(shared, programs, roots, frozen_application)?;
                self.stop_if_errors(Stage::Load)?;
                let projects = PerProject {
                    application: LoadedProject {
                        loaded: &application,
                        host,
                        request,
                        sources: sources.application,
                    },
                    runtime: LoadedProject {
                        loaded: &runtime,
                        host: runtime_host,
                        request: runtime_request,
                        sources: sources.runtime,
                    },
                };
                let loaded = LoadedBuild {
                    projects,
                    world_sessions: shared.world_sessions,
                    application: None,
                    session: shared.sessions.application,
                    atoms: shared.atoms,
                    messages: shared.messages,
                    builtin_names: shared.builtin_names,
                    can_load_code_at_run_time,
                    loads_code_by_unknown_names_alone,
                    keeps_library_code_without_names: roots.keeps_code_without_names,
                    holds_guessed_library_code: roots.holds_guessed_code,
                    library_code_asked: super::holds_test_files_alone(options)
                        .then_some(&roots.asks),
                    finish_asset_reads: project.finish_asset_reads,
                    known_library_regions: &|| {
                        let reach = runtime_host.reach.as_ref()?;
                        let is_last = group.last() == Some(&index);
                        let files = runtime.files();
                        Some(reach.known_regions(shared.runtime_modules, files, is_last))
                    },
                };
                result = Some(then(self, loaded)?);
            }
            if self.is_preloading {
                runtime_to_keep = Some((group[0], runtime));
            }
        }
        if let Some((index, runtime)) = runtime_to_keep {
            *kept_runtime = Some((roots.swap_remove(index), runtime));
        }
        Ok(result.expect("a build has a program"))
    }

    // Nothing but their number makes the entry points one program, so one more of them changes how all the others are compiled.
    fn warn_about_joined_programs(&mut self, files: &Files<'_>) {
        self.statistics.gave_up(LimitId::MaxProgramsPerBuild, None);
        let count = files.entry_points().len().to_string();
        let most = self.limits.get(LimitId::MaxProgramsPerBuild).to_string();
        let arguments = [count.as_bytes(), most.as_bytes()];
        let warning = Diagnostic::new(Code::EntryPointsCompiledTogether, None, &arguments);
        self.diagnostics.add(None, warning);
    }

    fn create_runtime_load_inputs<'c, 's>(
        &self,
        shared: &SharedLoadInputs<'c, 's>,
        session: &'s Session,
        roots: &RuntimeRoots,
        asks: Option<&'c RuntimeUses>,
    ) -> RuntimeLoadInputs<'c, 's>
    where
        'a: 'c,
    {
        let options = self.options;
        // A name that the build does not know may be the path of a file on disk. Code that the build does not see may name the module too.
        let is_told_of_code = options.can_load_code_at_run_time() || roots.imports_uncompiled_code;
        let loads_code_by_unknown_names_alone =
            !is_told_of_code && roots.loads_by_unknown_path && options.aot.loads_code_from_disk;
        let can_load_code_at_run_time = is_told_of_code || loads_code_by_unknown_names_alone;
        RuntimeLoadInputs {
            fold: create_runtime_fold_inputs(
                shared.manifest,
                session.arena(),
                &shared.atoms,
                shared.messages,
                &self.limits,
                self.platform,
                ProgramFacts {
                    can_load_code_at_run_time,
                    can_be_cluster_worker: roots.imports_cluster || can_load_code_at_run_time,
                    can_replace_builtins: !options.load.replaced_builtins.is_empty(),
                },
            ),
            code: CodeOptions {
                tsconfig_override: Some([VIRTUAL_ROOT, b"tsconfig.json"].concat()),
                ..CodeOptions::bun_run(VIRTUAL_ROOT.strip_suffix(b"/").unwrap_or(VIRTUAL_ROOT))
            },
            host: RuntimeHost {
                disk: shared.disk,
                runtime_modules: shared.runtime_modules,
                builtin_names: shared.builtin_names,
                platform: self.platform,
                replaced_builtins: &self.options.load.replaced_builtins,
                messages: shared.messages,
                unreadable: Default::default(),
                manifest: shared.manifest,
                // Code that the build does not see may use all that a file holds, so all that a file asks for is read.
                reach: (asks.filter(|_| !can_load_code_at_run_time)).map(|asks| {
                    ReachWhileLoading::new(asks, super::holds_test_files_alone(self.options))
                }),
                reads_types: can_load_code_at_run_time || asks.is_none_or(|asks| !asks.is_empty()),
            },
            can_load_code_at_run_time,
            loads_code_by_unknown_names_alone,
        }
    }

    fn create_runtime_request<'r, 's>(
        &self,
        shared: &SharedLoadInputs<'_, 's>,
        inputs: &'r RuntimeLoadInputs<'_, 's>,
        root_paths: &'r [Vec<u8>],
    ) -> CompileRequest<'r, 's>
    where
        'a: 'r,
    {
        CompileRequest {
            entry_points: EntryPoints::Resolved(root_paths),
            code: &inputs.code,
            fold: &inputs.fold,
            atoms: shared.atoms,
            libs: self.options.typescript_libs,
            project_origin: FileOrigin::Runtime,
            threads: self.threads,
            progress: None,
            left_out_bodies: None,
        }
    }

    fn load_runtime<'s>(
        &mut self,
        shared: &SharedLoadInputs<'_, 's>,
        session: &'s Session,
        host: &RuntimeHost<'_>,
        request: &CompileRequest<'_, 's>,
    ) -> Result<LoadedProgram<'s>, Stage> {
        let runtime = shared.parsed_before.load_program(session, host, request);
        self.finish_load(runtime, request, shared.messages)
    }

    /// The positions of the entry points that are loaded now. The others are left for loads of their own.
    fn leave_entry_points_of_other_projects(
        &mut self,
        host: &LoadHost<'_>,
        request: &CompileRequest<'_, '_>,
    ) -> Vec<usize> {
        let all = 0..self.options.entry_points.len();
        let separate = self
            .programs
            .filter(|programs| all.len() > 1 && !programs.is_joined);
        let found = separate.and_then(|programs| {
            Some((
                programs,
                find_configuration_of_each_entry_point(host, request)?,
            ))
        });
        let Some((programs, found)) = found else {
            return all.collect();
        };
        let mut left: Vec<(&[u8], Vec<usize>)> = Vec::new();
        for position in all.clone().filter(|&position| found[position] != found[0]) {
            let index = programs.indexes[position];
            match left.iter_mut().find(|it| it.0 == &found[position][..]) {
                Some(known) => known.1.push(index),
                None => left.push((&found[position], vec![index])),
            }
        }
        self.left_entry_points
            .extend(left.into_iter().map(|it| it.1));
        all.filter(|&position| found[position] == found[0])
            .collect()
    }

    /// See `Files::declaring_files_of_each_program` and `Files::is_program_in_order_of_its_own_load`. The programs that go on.
    fn leave_programs_that_see_declarations_of_others(
        &mut self,
        files: &Files<'_>,
        programs: Vec<(usize, Option<FileId>)>,
    ) -> Vec<(usize, Option<FileId>)> {
        let Some(of_one_load) = self.programs.filter(|_| programs.len() > 1) else {
            return programs;
        };
        let declaring = files.declaring_files_of_each_program();
        let mut all: Vec<FileId> = declaring.iter().flatten().copied().collect();
        all.shared_sort_unstable();
        all.dedup();
        let mut left: Vec<(&[FileId], Vec<usize>)> = Vec::new();
        let mut kept = Vec::with_capacity(programs.len());
        for (program, own) in programs.into_iter().zip(&declaring) {
            let index = of_one_load.indexes[program.0];
            // The numbers of the files are in what the front end hands on.
            if !(program.1).is_none_or(|first| files.is_program_in_order_of_its_own_load(first)) {
                self.left_entry_points.push(vec![index]);
                continue;
            }
            if *own == all {
                kept.push(program);
                continue;
            }
            match left.iter_mut().find(|it| it.0 == &own[..]) {
                Some(known) => known.1.push(index),
                None => left.push((own, vec![index])),
            }
        }
        self.left_entry_points
            .extend(left.into_iter().map(|it| it.1));
        kept
    }

    fn load_application<'s>(
        &mut self,
        session: &'s Session,
        host: &LoadHost<'_>,
        request: &CompileRequest<'_, 's>,
        shared: &SharedLoadInputs<'_, 's>,
    ) -> Result<LoadedProgram<'s>, Stage> {
        let (messages, parsed_before) = (shared.messages, shared.parsed_before);
        let mut result = parsed_before.load_program(session, host, request);
        if !host.reads_in_background_after_load()
            && !host.finish_background_reads()
            && result.is_ok()
            && !messages.has_errors()
        {
            drop(result);
            log_why_files_are_loaded_again(format_args!(
                "a file that was read beside the load is not what the load took it for"
            ));
            self.provider.clear_embedded_files();
            result = parsed_before.load_program(session, host, request);
        }
        self.finish_load(result, request, messages)
    }

    fn finish_load<'s>(
        &mut self,
        result: Result<LoadedProgram<'s>, LoadFailure>,
        request: &CompileRequest<'_, 's>,
        messages: &LoadMessages,
    ) -> Result<LoadedProgram<'s>, Stage> {
        self.diagnostics.add_load_messages(messages);
        match result {
            Ok(mut program) => {
                self.brings_bun_types |= program.brings_bun_types;
                let diagnostics = take(&mut program.diagnostics);
                self.diagnostics
                    .add_build_diagnostics(Stage::Load, diagnostics);
                Ok(program)
            }
            Err(failure) => {
                let entry_point_names = match request.entry_points {
                    EntryPoints::Written(specifiers)
                    | EntryPoints::WrittenFor(specifiers, _)
                    | EntryPoints::WrittenAndFound(specifiers, ..) => specifiers,
                    EntryPoints::Resolved(paths)
                    | EntryPoints::Imported(paths)
                    | EntryPoints::Configured(paths, _) => paths,
                };
                self.diagnostics
                    .add_load_failure(failure, entry_point_names);
                Err(Stage::Load)
            }
        }
    }

    /// `roots`: of Bun's own modules. `None`: `loaded` is the application.
    fn create_freeze_input<'i, 's>(
        &self,
        shared: &SharedLoadInputs<'_, '_>,
        loaded: &'i LoadedProgram<'s>,
        roots: Option<&'i RuntimeRoots>,
    ) -> FreezeInput<'i, 's>
    where
        'a: 'i,
    {
        FreezeInput {
            project: match roots {
                Some(_) => ProjectId::Runtime,
                None => ProjectId::Application,
            },
            files: loaded.files(),
            options: self.options,
            manifest: shared.manifest,
            host_loaded_modules: roots.map_or(&[], |it| &it.host_loaded_modules),
            modules_named_at_run_time: roots.map_or(&[], |it| &it.modules_named_at_run_time),
            is_world: false,
        }
    }

    fn freeze_projects(
        &mut self,
        shared: &SharedLoadInputs<'_, '_>,
        programs: PerProject<&LoadedProgram<'_>>,
        roots: &RuntimeRoots,
        frozen_application: Option<Result<FrozenSources, InternalError>>,
    ) -> Result<PerProject<Sources>, Stage> {
        let in_parallel = self.parallel_runner();
        let application = frozen_application.unwrap_or_else(|| {
            let input = self.create_freeze_input(shared, programs.application, None);
            freeze_sources(&input, &in_parallel)
        });
        let application = self.finish_freeze(programs.application, application)?;
        self.embed_files_that_fail_at_load(programs.application.files(), &application);
        let input = self.create_freeze_input(shared, programs.runtime, Some(roots));
        let runtime = freeze_sources(&input, &in_parallel);
        let sources = PerProject {
            application,
            runtime: self.finish_freeze(programs.runtime, runtime)?,
        };
        let frozen = sources.as_ref();
        let frozen = frozen.map(|project, sources| (programs.get(project).files(), sources));
        self.stop_at_internal_error(check_unique_paths_across_projects(frozen))?;
        Ok(sources)
    }

    /// `bun run` says what is wrong with such a file where the program loads it, in the words of the loader of its kind. So does an executable: the same loader reads what the executable holds.
    fn embed_files_that_fail_at_load(&self, files: &Files<'_>, sources: &Sources) {
        for &file in files.compiled_files() {
            let text =
                parsed_source(files, file).and_then(|it| it.text_that_fails_at_load.as_deref());
            if let Some(contents) = text {
                let source = SourceFile {
                    path: bun_sema_driver::host::to_native(files.module(file).file_name()),
                    contents,
                    loader: Loader::File,
                };
                let module_path = sources.module_paths(file).public_path;
                self.provider.embed_at_module_path(&source, module_path);
            }
        }
    }

    fn stop_at_internal_error<T>(&mut self, result: Result<T, InternalError>) -> Result<T, Stage> {
        result.map_err(|error| {
            self.diagnostics.add_internal_error(error);
            Stage::Load
        })
    }

    /// The sources of a program that checks a typed package by itself. The application reports what is wrong with them.
    pub(crate) fn freeze_world(&mut self, loaded: &LoadedProgram<'_>) -> Result<Sources, Stage> {
        let input = FreezeInput {
            project: ProjectId::Application,
            files: loaded.files(),
            options: self.options,
            manifest: Archive::embedded().manifest(),
            host_loaded_modules: &[],
            modules_named_at_run_time: &[],
            is_world: true,
        };
        let frozen = freeze_sources(&input, &self.parallel_runner());
        Ok(self.stop_at_internal_error(frozen)?.sources)
    }

    fn finish_freeze(
        &mut self,
        loaded: &LoadedProgram<'_>,
        frozen: Result<FrozenSources, InternalError>,
    ) -> Result<Sources, Stage> {
        let FrozenSources {
            sources,
            diagnostics,
            counters,
        } = self.stop_at_internal_error(frozen)?;
        let view = ProgramView {
            loaded,
            sources: &sources,
        };
        self.diagnostics.add_buffer(view, diagnostics);
        for &file in view.files().compiled_files() {
            self.diagnostics.add_fold_errors(view, file);
        }
        self.statistics.add_counters(view, counters);
        Ok(sources)
    }
}

// Of the files of several entry points. A global begins at each of them, and what the compiler proves holds for one global, so each begins
// a program of its own. They are one program where that gains nothing or costs the executable its size:
// - nothing starts a Worker, so there is one global;
// - a program constructs Workers of node:worker_threads. The host loads that module into the global of each, so every program would hold a
//   copy of it and of the streams, the console and the file system behind it;
// - a program loads a module by a name that the build does not know, which may be that of any entry point: it has to hold them all;
// - the programs share much of their files, and a file is compiled once for each program that holds it;
// - there are very many: `has_too_many_entry_points`.
// The walk visits a file once for each program that holds it and stops where the programs share too much, so its cost is linear in the text.
fn are_one_program(
    files: &Files<'_>,
    has_first_of_build: bool,
    constructs_node_workers: bool,
    limits: &LimitValues,
    statistics: &mut Statistics,
) -> bool {
    const NO_PROGRAM: u32 = u32::MAX;
    let limit = |limit: LimitId| usize::try_from(limits.get(limit)).unwrap_or(usize::MAX);
    if constructs_node_workers {
        return true;
    }
    let entry_points = files.entry_points();
    if has_first_of_build {
        // SAFETY: the load has ended, and no thread works for the build.
        unsafe { files.view_program(Some(entry_points[0])) };
        let starts_workers = mentions_worker_constructor(files);
        // SAFETY: as above.
        unsafe { files.view_program(None) };
        if !starts_workers {
            return true;
        }
    }
    let text_of = |file: FileId| files.module(file).hir.text.len();
    let mut is_compiled = vec![false; files.modules.len()];
    let mut size_of_loaded = 0;
    for &file in files.compiled_files() {
        is_compiled[file.idx()] = true;
        size_of_loaded += text_of(file);
    }
    let most = limit(LimitId::MaxRepeatedSourceBytes);
    let share_of = |size: usize| size / 100 * limit(LimitId::MaxRepeatedSourcePercent);
    // The programs hold no more than was loaded.
    let most_of_any_programs = most.max(share_of(size_of_loaded));
    let mut last_holder = vec![NO_PROGRAM; files.modules.len()];
    let (mut size_of_all, mut repeated) = (0, 0);
    let mut pending: Vec<FileId> = Vec::new();
    for (program, &first) in entry_points.iter().enumerate() {
        pending.push(first);
        while let Some(file) = pending.pop() {
            let holder = core::mem::replace(&mut last_holder[file.idx()], program as u32);
            if holder == program as u32 {
                continue;
            }
            pending.extend_from_slice(files.module(file).code_edges);
            if !is_compiled[file.idx()] {
                continue;
            }
            if holder != NO_PROGRAM {
                repeated += text_of(file);
            } else if loads_modules_by_names_that_are_not_constant(files, file) {
                return true;
            } else {
                size_of_all += text_of(file);
            }
        }
        if repeated > most_of_any_programs {
            size_of_all = size_of_loaded;
            break;
        }
    }
    let share = share_of(size_of_all);
    if repeated > most.max(share) {
        statistics.gave_up(
            match share > most {
                true => LimitId::MaxRepeatedSourcePercent,
                false => LimitId::MaxRepeatedSourceBytes,
            },
            None,
        );
        return true;
    }
    false
}

// Pages or plugins that a pattern has found. Each program costs the build and the executable a fixed amount.
fn has_too_many_entry_points(files: &Files<'_>, limits: &LimitValues) -> bool {
    files.entry_points().len() as u64 > limits.get(LimitId::MaxProgramsPerBuild)
}

fn texts_of_program_files<'f, 's>(
    files: &'f Files<'s>,
) -> impl Iterator<Item = (&'s [u8], usize)> + use<'f, 's> {
    let compiled = files.compiled_files().iter();
    let programs = compiled.filter(|&&file| {
        parsed_source(files, file).is_some_and(|source| source.kind == SourceKind::Program)
    });
    programs.map(|&file| {
        let module = files.module(file);
        (module.file_name(), module.hir.text.len())
    })
}

fn is_test_run(options: &Options<'_>) -> bool {
    options.load.runs_tests && !options.aot.checks_only
}

// The rule of `are_one_program` for Bun's own modules. Each of `loaded` is what the programs of one group hold of them.
// Of a file of functions a program holds only those that it reaches, so those files do not count.
fn repeat_much_library_text<'l, 's: 'l>(
    application: &Files<'_>,
    loaded: impl Iterator<Item = (&'l Vec<usize>, &'l LoadedProgram<'s>)>,
    limits: &LimitValues,
    statistics: &mut Statistics,
) -> bool {
    let limit = |limit: LimitId| usize::try_from(limits.get(limit)).unwrap_or(usize::MAX);
    let text_of = |files: &Files<'_>, file: FileId| files.module(file).hir.text.len();
    let compiled = application.compiled_files().iter();
    let mut size_of_all: usize = compiled.map(|&file| text_of(application, file)).sum();
    let mut repeated = 0;
    let mut held: Vec<&[u8]> = Vec::new();
    for (group, runtime) in loaded {
        let files = runtime.files();
        let is_module = |file: &&FileId| {
            let source = parsed_source(files, **file);
            source.is_some_and(|it| matches!(it.kind, SourceKind::RuntimeModule(_)))
        };
        for &file in files.compiled_files().iter().filter(is_module) {
            let size = text_of(files, file);
            let path = files.module(file).file_name();
            let is_new = !held.contains(&path);
            if is_new {
                held.push(path);
                size_of_all += size;
            }
            repeated += size * (group.len() - usize::from(is_new));
        }
    }
    let share = size_of_all / 100 * limit(LimitId::MaxRepeatedSourcePercent);
    let most = limit(LimitId::MaxRepeatedSourceBytes);
    if repeated <= most.max(share) {
        return false;
    }
    statistics.gave_up(
        match share > most {
            true => LimitId::MaxRepeatedSourcePercent,
            false => LimitId::MaxRepeatedSourceBytes,
        },
        None,
    );
    true
}

// The rule of `are_one_program` for the files of a program that is loaded behind the others.
fn repeats_much_text(files: &Files<'_>, held: &[(Vec<u8>, usize)], limits: &LimitValues) -> bool {
    let limit = |limit: LimitId| usize::try_from(limits.get(limit)).unwrap_or(usize::MAX);
    let is_held = |path: &[u8]| held.binary_search_by(|it| it.0[..].cmp(path)).is_ok();
    let mut size_of_all: usize = held.iter().map(|it| it.1).sum();
    let mut repeated = 0;
    for (path, size) in texts_of_program_files(files) {
        match is_held(path) {
            true => repeated += size,
            false => size_of_all += size,
        }
    }
    let share = size_of_all / 100 * limit(LimitId::MaxRepeatedSourcePercent);
    repeated > limit(LimitId::MaxRepeatedSourceBytes).max(share)
}

// No fewer than `loads_modules_by_computed_names` finds once the modules are bound.
fn loads_modules_by_names_that_are_not_constant(files: &Files<'_>, file: FileId) -> bool {
    parsed_source(files, file).is_none_or(|it| it.builtins.loads_unknown_modules())
        || (files.analysis(file).import_sites.iter())
            .any(|site| !matches!(site.specifier, ImportSpecifier::Constant(_)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::builtins::RuntimeModule;
    use crate::compile::testing::{BUNDLED_LIBS, TestProject, default_settings, describe_messages};
    use crate::load::source_provider::WithoutServices;
    use bun_ast::Log;
    use bun_sema::fold::{Constant, Decision};
    use bun_sema::hir::{ExprId, ExprKind};
    use bun_sema_driver::ThreadCaches;

    fn can_runtime_sources_load_code(admits_inspector: bool, external_packages: &[&[u8]]) -> bool {
        const NAME: &[u8] = b"CAN_LOAD_CODE_AT_RUN_TIME";
        let files = [
            ("a.ts", "import 'node:path';"),
            (
                "/$bun/js/node/path.ts",
                "export default CAN_LOAD_CODE_AT_RUN_TIME;",
            ),
        ];
        let mut project = TestProject::new(&files, &default_settings());
        project.aot.admits_inspector = admits_inspector;
        let mut options = project.options(BUNDLED_LIBS);
        options.load.externals.packages =
            external_packages.iter().map(|name| name.to_vec()).collect();
        let caches = ThreadCaches::default();
        let mut build = Build::new(&options, &WithoutServices, &caches, LimitValues::for_host());
        let decided = build.with_loaded_projects(|_, loaded| {
            let runtime = loaded.project(ProjectId::Runtime);
            let files = runtime.loaded.files();
            let file = runtime
                .sources
                .runtime_module_file(RuntimeModule::NodePath)
                .unwrap();
            let mut exprs = files.hir(file).exprs.iter();
            let index = exprs.position(|expr| {
                matches!(expr.kind, ExprKind::Ident(atom) if files.atoms.bytes(atom) == NAME)
            });
            let decisions = &files.analysis(file).decisions;
            match decisions.decision(ExprId(index.unwrap() as u32)) {
                Decision::Constant(Constant::Boolean(can_load_code)) => Ok(can_load_code),
                other => panic!("{other:?}"),
            }
        });
        let mut log = Log::init();
        match build.finish(decided, &mut log) {
            Ok((can_load_code, _)) => can_load_code,
            Err(failed) => panic!("{}: {}", failed.stage.name(), describe_messages(&log)),
        }
    }

    #[test]
    fn inspector_and_externals_let_runtime_sources_load_code() {
        assert!(!can_runtime_sources_load_code(false, &[]));
        assert!(can_runtime_sources_load_code(true, &[]));
        assert!(can_runtime_sources_load_code(false, &[b"left-pad"]));
    }
}
