use super::import_graph::ImportGraph;
use super::runtime_reach::ReachWhileLoading;
use super::{
    Build, LoadedBuild, LoadedProject, Options, ProgramsOfOneLoad, library_code_of,
    mentions_worker_constructor, preload_of,
};
use crate::builtins::{BuiltinNames, RuntimeUses};
use crate::diagnostics::{Diagnostics, InternalError, LoadMessages, ProgramView};
use crate::link::run_beside;
use crate::load::fold_inputs::{
    ProgramFacts, create_application_fold_inputs, create_runtime_fold_inputs,
};
use crate::load::host::{LoadHost, LoadHostInput, create_disk};
use crate::load::is_in_archive_of_bun;
use crate::load::named_loads::resolve_loads_through_imported_loaders;
use crate::load::runtime_host::RuntimeHost;
use crate::load::runtime_modules::RuntimeModules;
use crate::load::runtime_roots::{
    FurtherLibraryCode, RuntimeRoots, collect_runtime_roots, join_asks, join_root_paths,
};
use crate::load::sources::{
    FreezeInput, FrozenSources, check_unique_paths_across_projects, freeze_sources, parsed_source,
};
use crate::load::worker_files::{
    WorkerSearch, find_code_that_starts_workers, find_embedded_code_files, source_path_of,
};
use crate::load::{PerProject, ProjectId, SourceKind, Sources};
use crate::statistics::{LimitId, LimitValues, Stage, StatisticId, Statistics};
use bun_builtin_sources::{Archive, Manifest, VIRTUAL_ROOT};
use bun_sema::atom::Interner;
use bun_sema::check::aot::FileOrigin;
use bun_sema::fold::FoldInputs;
use bun_sema::import_sites::ImportSpecifier;
use bun_sema::program::{FileId, Files, MainModule, Run};
use bun_sema::resolve::{CodeHost, CodeOptions};
use bun_sema::session::Session;
use bun_sema_driver::host::Disk;
use bun_sema_driver::{
    ChosenThreads, CompileRequest, EntryPoints, LoadFailure, LoadedProgram,
    find_configuration_of_each_entry_point, fit_threads_to_sources, load_program_with_parsed_files,
    resolve_entry_point,
};
use bun_threading::Guarded;
use core::sync::atomic::Ordering;
use std::cell::{Cell, RefCell};
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
    world_sessions: &'s [Session],
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
        let world_sessions: Vec<Session> = (0..64).map(|_| Session::new()).collect();
        let program_count = self.programs.map_or(1, |programs| programs.indexes.len());
        let further: Vec<Session> = (1..program_count).map(|_| Session::new()).collect();
        let all = (sessions.as_ref(), &world_sessions[..], &further[..]);
        let result = self.load_in_sessions(all, asset_reads, then);
        self.retired_sessions
            .extend([sessions.application, sessions.runtime]);
        let others = world_sessions.into_iter().chain(further);
        self.retired_sessions
            .extend(others.filter(|session| !session.is_unused()));
        result
    }

    fn load_in_sessions<R>(
        &mut self,
        (sessions, world_sessions, further_runtime_sessions): (
            PerProject<&Session>,
            &[Session],
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
            max_computed_candidates: max_computed_candidates(&self.limits),
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
        let written_for_programs = |entry_points| {
            EntryPoints::WrittenFor(entry_points, MainModule::EntryPointOfProcessOrWorker)
        };
        let request = CompileRequest {
            entry_points: match self.programs {
                None => EntryPoints::Written(&options.entry_points),
                Some(_) => written_for_programs(&options.entry_points),
            },
            code: &code,
            fold: shared.application_fold,
            atoms: shared.atoms,
            libs: options.typescript_libs,
            project_origin: FileOrigin::NoFile,
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
        std::thread::scope(|scope| {
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
                self.provider.clear_embedded_files();
                self.diagnostics = Diagnostics::new();
                self.statistics = Statistics::default();
            }
        })
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

    /// `kept_runtime`: Bun's own code as an earlier program of the build has loaded it. The placeholder of `Preload` leaves it there.
    fn load_and_compile<'s, R>(
        &mut self,
        shared: &SharedLoadInputs<'_, 's>,
        project: &ApplicationLoad<'_, '_, '_, '_, 's>,
        then: Then<'_, 'a, R>,
        kept_runtime: &mut Option<(RuntimeRoots, LoadedProgram<'s>)>,
    ) -> Result<R, Stage> {
        let options = self.options;
        let (host, request, positions) = (project.host, project.request, project.positions);
        let session = shared.sessions.application;
        let mut application = self.load_application(session, host, request, shared)?;
        if project.asset_reads == AssetReads::FinishedLater {
            read_assets(project.scope, host);
        }
        if options.aot.checks_only && options.entry_points.len() > 1 {
            self.import_graph = Some(ImportGraph::of(application.files()));
        }
        resolve_loads_through_imported_loaders(application.files(), &self.parallel_runner());

        let files = application.files();
        self.started_workers = Default::default();
        if !options.aot.checks_only {
            self.started_workers.copies =
                find_embedded_code_files(files, &options.load.loaders, &self.parallel_runner());
        }
        if !options.aot.checks_only && mentions_worker_constructor(files) {
            let code_from_root = CodeOptions {
                working_directory: bun_sema_driver::host::from_native(
                    &options.paths.root_directory,
                ),
                ..request.code.clone()
            };
            let search = WorkerSearch {
                limits: &self.limits,
                loaders: &options.load.loaders,
                paths: &options.paths,
                runs_in_place: options.aot.runs_in_place,
                provider: self.provider,
                resolve_entry_point: &|written| resolve_entry_point(host, request.code, written),
                resolve_bare_name: &|name| resolve_entry_point(host, &code_from_root, name),
            };
            let found = find_code_that_starts_workers(files, &search, &self.parallel_runner());
            self.started_workers.files = found.files;
            self.started_workers.names = found.names;
            self.started_workers.code = found.code;
            self.started_workers.constructs_node_workers = found.constructs_node_workers;
        }
        if !self.started_workers.copies.is_empty() || !self.started_workers.files.is_empty() {
            self.started_workers.held_texts = texts_of_program_files(files)
                .map(|(path, size)| (path.to_vec(), size))
                .collect();
        }
        let view = |first: Option<FileId>| {
            // SAFETY: the load has ended, and between two programs no thread works for the build.
            unsafe { files.view_program(first) };
        };
        // Each program with its position and the file it begins at. A build of one program looks at all that was loaded.
        let programs: Vec<(usize, Option<FileId>)> = match self.programs {
            None => vec![(0, None)],
            Some(of_one_load) if of_one_load.only_looks_for_worker_threads => {
                self.is_one_program = files.entry_points().iter().any(|&first| {
                    view(Some(first));
                    !mentions_worker_constructor(files)
                });
                view(None);
                return Err(Stage::Load);
            }
            Some(ProgramsOfOneLoad {
                held_elsewhere: Some(held),
                indexes,
                ..
            }) => {
                let most = self.limits.get(LimitId::MaxProgramsPerBuild);
                if indexes[0] as u64 >= most || repeats_much_text(files, held, &self.limits) {
                    self.is_one_program = true;
                    return Err(Stage::Load);
                }
                let first_files = files.entry_points().iter().copied().map(Some);
                positions.iter().copied().zip(first_files).collect()
            }
            Some(of_one_load)
                if files.entry_points().len() != positions.len()
                    || (!self.options.aot.separates_programs
                        && are_one_program(
                            files,
                            of_one_load.indexes[positions[0]] == 0,
                            self.started_workers.constructs_node_workers,
                            &self.limits,
                        )) =>
            {
                let holds_all = of_one_load.are_all_of_the_build
                    && of_one_load.indexes.len() == positions.len();
                if !holds_all {
                    self.is_one_program = true;
                    return Err(Stage::Load);
                }
                // What was loaded is what a build of one program loads.
                self.programs = None;
                vec![(0, None)]
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
        let mut roots: Vec<RuntimeRoots> = programs
            .iter()
            .map(|&(position, first)| {
                if first.is_some() {
                    view(first);
                }
                let of_program = self.programs.map(|all| &all.options[position].load);
                let load = of_program.unwrap_or(&options.load);
                let lacked_before = library_code_of(&load.library_code_lacked);
                let further = FurtherLibraryCode {
                    lacked_before: &lacked_before,
                    // What is loaded ahead of a program serves whatever that program asks for.
                    serves_unseen_code: load.keeps_library_code_without_names
                        || options.can_load_code_at_run_time()
                        || preload_of(options).is_some(),
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
        let mut result = None;
        let mut runtime_to_keep = None;
        for (group_index, group) in groups.iter().enumerate() {
            let started = Instant::now();
            self.lowered_runtimes.begin_load();
            let asks = join_asks(group.iter().map(|&index| &roots[index].asks));
            let of_group = group.iter().map(|&index| &roots[index]);
            let mut root_paths = join_root_paths(shared.runtime_modules, of_group);
            let roots = &roots[group[0]];
            let session = match group_index {
                0 => shared.sessions.runtime,
                _ => &shared.further_runtime_sessions[group_index - 1],
            };
            // What is loaded ahead of a program serves whatever that program asks for.
            let asks = preload_of(options).is_none().then_some(&asks);
            let inputs = self.create_runtime_load_inputs(shared, session, roots, asks);
            if !inputs.host.reads_types {
                root_paths.clear();
            }
            let runtime_request = self.create_runtime_request(shared, &inputs, &root_paths);
            let RuntimeLoadInputs {
                host: ref runtime_host,
                can_load_code_at_run_time,
                loads_code_by_unknown_names_alone,
                ..
            } = inputs;
            let kept = kept_runtime.take();
            let mut frozen_application = None;
            let mut runtime = match kept.filter(|(known, _)| asks_the_same(known, roots)) {
                Some((_, runtime)) => runtime,
                // Each of several programs has options and a view of the files of its own.
                None if self.programs.is_none() => {
                    let input = self.create_freeze_input(shared, &application, None);
                    let in_parallel = self.parallel_runner();
                    let (frozen, runtime) = run_beside(
                        &self.beside_runner(),
                        || freeze_sources(&input, &in_parallel),
                        || {
                            let parsed_before = shared.parsed_before;
                            parsed_before.load_program(session, runtime_host, &runtime_request)
                        },
                    );
                    frozen_application = Some(frozen);
                    self.finish_load(runtime, &runtime_request, shared.messages)?
                }
                None => self.load_runtime(shared, session, runtime_host, &runtime_request)?,
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
                        request: &runtime_request,
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

    fn create_runtime_load_inputs<'c, 's>(
        &self,
        shared: &SharedLoadInputs<'c, 's>,
        session: &'s Session,
        roots: &RuntimeRoots,
        asks: Option<&'c RuntimeUses>,
    ) -> RuntimeLoadInputs<'c, 's> {
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
                },
            ),
            code: CodeOptions {
                tsconfig_override: Some([VIRTUAL_ROOT, b"tsconfig.json"].concat()),
                max_computed_candidates: max_computed_candidates(&self.limits),
                ..CodeOptions::bun_run(VIRTUAL_ROOT.strip_suffix(b"/").unwrap_or(VIRTUAL_ROOT))
            },
            host: RuntimeHost {
                disk: shared.disk,
                runtime_modules: shared.runtime_modules,
                builtin_names: shared.builtin_names,
                platform: self.platform,
                messages: shared.messages,
                unreadable: Default::default(),
                manifest: shared.manifest,
                // Code that the build does not see may use all that a file holds, so all that a file asks for is read.
                reach: (asks.filter(|_| !can_load_code_at_run_time)).map(ReachWhileLoading::new),
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
        let found = (self.programs.filter(|_| all.len() > 1)).and_then(|programs| {
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
        all.sort_unstable();
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
                    EntryPoints::Written(specifiers) | EntryPoints::WrittenFor(specifiers, _) => {
                        specifiers
                    }
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
// - a Worker of node:worker_threads may begin at a program without that module, which the host loads into its global;
// - a program loads a module by a name that the build does not know, which may be that of any entry point: it has to hold them all;
// - the programs share much of their files, and a file is compiled once for each program that holds it;
// - there are very many: pages or plugins that a pattern has found.
fn are_one_program(
    files: &Files<'_>,
    has_first_of_build: bool,
    constructs_node_workers: bool,
    limits: &LimitValues,
) -> bool {
    let limit = |limit: LimitId| usize::try_from(limits.get(limit)).unwrap_or(usize::MAX);
    let entry_points = files.entry_points();
    let view = |first: Option<FileId>| {
        // SAFETY: the load has ended, and no thread works for the build.
        unsafe { files.view_program(first) };
    };
    let size_of = |compiled: &[FileId]| -> usize {
        let texts = compiled
            .iter()
            .map(|&file| files.module(file).hir.text.len());
        texts.sum()
    };
    let mut is_held = vec![false; files.modules.len()];
    let (mut size_of_all, mut size_of_each) = (0, 0);
    let mut are_one = entry_points.len() > limit(LimitId::MaxProgramsPerBuild);
    for (position, &first) in entry_points.iter().enumerate() {
        if are_one {
            break;
        }
        view(Some(first));
        let compiled = files.compiled_files();
        let is_first_of_build = position == 0 && has_first_of_build;
        are_one = ((is_first_of_build || constructs_node_workers)
            && !mentions_worker_constructor(files))
            || loads_modules_by_names_that_are_not_constant(files);
        size_of_each += size_of(compiled);
        for &file in compiled {
            if !core::mem::replace(&mut is_held[file.idx()], true) {
                size_of_all += size_of(&[file]);
            }
        }
    }
    view(None);
    let repeated = size_of_each - size_of_all;
    let share = size_of_all / 100 * limit(LimitId::MaxRepeatedSourcePercent);
    are_one || repeated > limit(LimitId::MaxRepeatedSourceBytes).max(share)
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
fn loads_modules_by_names_that_are_not_constant(files: &Files<'_>) -> bool {
    files.compiled_files().iter().any(|&file| {
        parsed_source(files, file).is_none_or(|it| it.builtins.loads_unknown_modules())
            || (files.analysis(file).import_sites.iter())
                .any(|site| !matches!(site.specifier, ImportSpecifier::Constant(_)))
    })
}

pub(super) fn max_computed_candidates(limits: &LimitValues) -> u32 {
    let limit = limits.get(LimitId::MaxComputedSpecifierCandidates);
    u32::try_from(limit).unwrap_or(u32::MAX)
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
