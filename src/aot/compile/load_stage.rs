use super::{Build, CodeOfWorkers, EntryPointPaths, LoadedBuild, LoadedProject, Options};
use crate::builtins::table::{self, BuiltinId};
use crate::builtins::{BuiltinNames, ResolvedBuiltins, RuntimeModule};
use crate::diagnostics::{InternalError, LoadMessages, ProgramView};
use crate::link::run_beside;
use crate::load::contents::worker_entries::source_path_of;
use crate::load::contents::{
    ContentsInput, EntryPointFinder, FinderInput, FoundEntryPoint, ProgramContents,
    collect_program_contents,
};
use crate::load::fold_inputs::{
    ProgramFacts, create_application_fold_inputs, create_runtime_fold_inputs,
};
use crate::load::host::{LoadHost, LoadHostInput, create_disk};
use crate::load::runtime_host::RuntimeHost;
use crate::load::runtime_modules::RuntimeModules;
use crate::load::runtime_roots::{FurtherLibraryCode, RuntimeRoots, collect_runtime_roots};
use crate::load::sources::{
    FreezeInput, FrozenSources, check_unique_paths_across_projects, freeze_sources, parsed_source,
};
use crate::load::{PerProject, ProjectId, Sources};
use crate::modules::asks_for_original_beside_mock;
use crate::statistics::{Stage, StepClock};
use bun_builtin_sources::{Archive, Manifest, VIRTUAL_ROOT};
use bun_sema::atom::Interner;
use bun_sema::check::aot::FileOrigin;
use bun_sema::fold::FoldInputs;
use bun_sema::hir::ExprId;
use bun_sema::program::{CodeAnswer, CodeView, FileId, Files, MainModule};
use bun_sema::resolve::{CodeHost, CodeOptions};
use bun_sema::session::Session;
use bun_sema::util::{FxHashSet, SharedSort};
use bun_sema_driver::host::Disk;
use bun_sema_driver::{
    ChosenThreads, CompileRequest, EntryPoints, LoadFailure, LoadedProgram, fit_threads_to_sources,
    load_program,
};
use bun_threading::Guarded;
use std::cell::Cell;
use std::mem::take;
use std::thread::Scope;

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

/// What the files alone show. `Build::finish_started_workers` may only raise it to `Unseen`.
fn code_of_workers(contents: &ProgramContents) -> CodeOfWorkers {
    match (
        contents.names_worker_constructor,
        contents.hands_worker_constructor_on || contents.starts_worker_out_of_sight,
    ) {
        (false, _) => CodeOfWorkers::NoneNamed,
        (true, true) => CodeOfWorkers::Unseen,
        (true, false) => CodeOfWorkers::Compiled,
    }
}

// An executable for Windows knows its modules as `B:\~BUN\root\a.js`, and an alias is written with forward slashes.
fn is_path_of_module(public_path: &[u8], alias: &[u8]) -> bool {
    let is_same_byte =
        |(&held, &written): (&u8, &u8)| held == written || (held == b'\\' && written == b'/');
    public_path.len() == alias.len() && public_path.iter().zip(alias).all(is_same_byte)
}

/// `StartedWorkers::names`. `names_written`: `EntryPointFinder::take_names_written`.
fn collect_entry_point_aliases(
    files: &Files<'_>,
    sources: &Sources,
    mut names_written: Vec<EntryPointPaths>,
) -> Vec<EntryPointPaths> {
    names_written.shared_sort_unstable();
    names_written.dedup();
    // The run cannot tell two files apart that go by one name.
    let same_name = |a: &EntryPointPaths, b: &EntryPointPaths| a.public_path == b.public_path;
    let unambiguous = names_written.chunk_by(same_name).filter(|it| it.len() == 1);
    let mut aliases: Vec<EntryPointPaths> = unambiguous.flatten().cloned().collect();
    // The path of a module leads to that module.
    aliases.retain(|alias| {
        let mut compiled = files.compiled_files().iter();
        !compiled.any(|&file| is_path_of_module(sources.public_path(file), &alias.public_path))
    });
    // The load may leave out a file that it was told of, and a Worker that is given the name of such a file fails to load.
    let begun_at = files.entry_points().iter();
    let begun_at: FxHashSet<Vec<u8>> = begun_at
        .map(|&file| source_path_of(files.module(file).file_name()))
        .collect();
    aliases.retain(|alias| begun_at.contains(&alias.source_path));
    aliases
}

/// `Module._load = f`, `Module._resolveFilename = f`, `Module.prototype.require = f`, `require.extensions[".x"] = f`: from the store on, a `require("./a")` anywhere in the run
/// may be answered with a file that no import names. Nobody follows the object to the store (`__toESM(require("module"))._load = f`), so whoever gets at the object of
/// node:module, at a member of it other than `createRequire`, or at a table of loaders counts.
fn gets_at_module_loader(files: &Files<'_>, file: FileId, builtins: &ResolvedBuiltins) -> bool {
    let is =
        |id: BuiltinId, other: BuiltinId| table::canonical_id(id) == table::canonical_id(other);
    let tables_of_loaders = [
        BuiltinId::ModuleRequireExtensions,
        BuiltinId::ModuleRequirePrototypeExtensions,
        BuiltinId::NodeModule_extensions,
    ];
    // `import { createRequire } from "node:module"` mentions the module, and no expression of the file is its object.
    let holds_object = || {
        let expressions = (0..files.hir(file).exprs.len() as u32).map(ExprId);
        let mut builtins_held = expressions.filter_map(|it| builtins.builtin_of_expression(it));
        builtins_held.any(|id| is(id, BuiltinId::NodeModule))
    };
    builtins.mentioned().iter().any(|&id| {
        // `Module.Module` is the object itself.
        match is(id, BuiltinId::NodeModule) {
            true => holds_object(),
            false => {
                let mut members = table::members(BuiltinId::NodeModule).iter();
                tables_of_loaders.iter().any(|&loaders| is(id, loaders))
                    || (!is(id, BuiltinId::NodeModuleCreateRequire)
                        && members.any(|&member| is(id, member)))
            }
        }
    })
}

/// Whether code that is not in the image may come to run through what the file does, other than by a load under a name that the build does not know.
/// The host reads the original beside a mock from disk, and makes the module for a mock without a factory of text.
fn may_run_code_outside_image(files: &Files<'_>, file: FileId) -> bool {
    let (Some(source), Some(compiled)) = (parsed_source(files, file), files.compiled(file)) else {
        return true;
    };
    let is_test_runner = |site: usize| {
        matches!(compiled.code_answers.get(site), Some(&CodeAnswer::HostModule(id))
            if RuntimeModule::from_registry_id(id.0) == Some(RuntimeModule::BunTest))
    };
    let builtins = &source.builtins;
    builtins.mentions_evaluator()
        || gets_at_module_loader(files, file, builtins)
        || asks_for_original_beside_mock(
            files.hir(file),
            files.bound(file),
            &compiled.analysis,
            builtins,
            &files.atoms,
            &is_test_runner,
        )
}

/// What `EntryPointFinder` knows when the application is loaded.
#[derive(Default)]
struct FoundByLoad {
    entry_points: Vec<FoundEntryPoint>,
    names_written: Vec<EntryPointPaths>,
}

struct ApplicationLoad<'l, 'scope, 'env, 'h, 's> {
    host: &'scope LoadHost<'h>,
    request: &'l CompileRequest<'l, 's>,
    scope: &'scope Scope<'scope, 'env>,
    asset_reads: AssetReads,
    finish_asset_reads: &'l dyn Fn(),
}

struct SharedLoadInputs<'c, 's> {
    disk: &'c Disk,
    sessions: PerProject<&'s Session>,
    atoms: Interner<'s>,
    application_fold: &'c FoldInputs<'s>,
    builtin_names: &'c BuiltinNames,
    manifest: &'static Manifest,
    runtime_modules: &'c RuntimeModules,
    messages: &'c LoadMessages,
}

/// What the request for a load of Bun's own code borrows.
struct RuntimeLoadInputs<'c, 's> {
    fold: FoldInputs<'s>,
    code: CodeOptions,
    host: RuntimeHost<'c>,
    can_load_code_at_run_time: bool,
    loads_code_by_unknown_names_alone: bool,
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
        let result = self.load_in_sessions(sessions.as_ref(), asset_reads, then);
        self.retired_sessions
            .extend([sessions.application, sessions.runtime]);
        result
    }

    fn load_in_sessions<R>(
        &mut self,
        sessions: PerProject<&Session>,
        asset_reads: AssetReads,
        then: Then<'_, 'a, R>,
    ) -> Result<R, Stage> {
        self.clock.start(Stage::Load);
        let mut steps = StepClock::new(Stage::Load);
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
        let atoms = Interner::new_in(application_session);
        let builtin_names = BuiltinNames::new(&atoms);
        let archive = Archive::embedded();
        let natives = archive.manifest().natives().iter();
        let natives = natives.map(|native| (&*native.name, native.is_also_member_of_global_this));
        crate::builtins::resolve::set_natives(natives);
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
            self.platform,
            options.aot.runs_in_place || options.load.runs_tests,
        );
        let shared = SharedLoadInputs {
            disk: &disk,
            sessions,
            atoms,
            application_fold: &application_fold,
            builtin_names: &builtin_names,
            manifest: archive.manifest(),
            runtime_modules: &runtime_modules,
            messages: &messages,
        };
        steps.end("disk, names of built-ins, what folds");
        let result = self.load_projects(&shared, asset_reads, then);
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
        // What a file mocks is known when the last file is loaded, and each file is resolved as it is loaded.
        let code = CodeOptions {
            mocks_any_file: options.load.runs_tests,
            follows_paths_to_functions_of_other_files: options.load.runs_tests,
            ..options.code.clone()
        };
        let host = LoadHost::new(LoadHostInput {
            disk: shared.disk,
            provider: self.provider,
            options,
            runtime_modules: shared.runtime_modules,
            messages: shared.messages,
            builtin_names: shared.builtin_names,
            platform: self.platform,
        });
        let host = match asset_reads {
            #[cfg(test)]
            AssetReads::FinishedByLoad => host,
            AssetReads::FinishedLater => host.reading_in_background_after_load(),
        };
        let request = CompileRequest {
            entry_points: EntryPoints::Written(&options.entry_points),
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
        let result = std::thread::scope(|scope| {
            let are_asset_reads_finished = Cell::new(false);
            let finish_asset_reads = || {
                if !are_asset_reads_finished.replace(true) {
                    host.finish_background_reads();
                }
            };
            let project = ApplicationLoad {
                host: &host,
                request: &request,
                scope,
                asset_reads,
                finish_asset_reads: &finish_asset_reads,
            };
            let result = self.load_and_compile(shared, &project, then);
            finish_asset_reads();
            if asset_reads == AssetReads::FinishedLater {
                self.diagnostics.add_load_messages(shared.messages);
            }
            result
        });
        self.leftovers.push(host.into_leftovers());
        result
    }

    fn load_and_compile<'s, R>(
        &mut self,
        shared: &SharedLoadInputs<'_, 's>,
        project: &ApplicationLoad<'_, '_, '_, '_, 's>,
        then: Then<'_, 'a, R>,
    ) -> Result<R, Stage> {
        let options = self.options;
        let (host, request) = (project.host, project.request);
        let mut steps = StepClock::new(Stage::Load);
        let (application, found) = match options.aot.checks_only {
            true => {
                let application = self.load_application(shared, project, request)?;
                (application, FoundByLoad::default())
            }
            false => {
                let finder = EntryPointFinder::new(FinderInput {
                    host,
                    code: request.code,
                    options,
                });
                let find = |code: &dyn CodeView<'_>| -> Vec<Vec<u8>> { finder.find(code) };
                let request_that_finds = CompileRequest {
                    entry_points: EntryPoints::WrittenAndFound(
                        &options.entry_points,
                        MainModule::EntryPoint,
                        &find,
                    ),
                    ..*request
                };
                let application = self.load_application(shared, project, &request_that_finds)?;
                let names_written = finder.take_names_written();
                let found = FoundByLoad {
                    entry_points: finder.finish(application.files(), options.entry_points.len()),
                    names_written,
                };
                (application, found)
            }
        };
        steps.end("the application");
        if project.asset_reads == AssetReads::FinishedLater {
            read_assets(project.scope, host);
        }
        self.compile_loaded(shared, project, application, found, then)
    }

    fn compile_loaded<'s, R>(
        &mut self,
        shared: &SharedLoadInputs<'_, 's>,
        project: &ApplicationLoad<'_, '_, '_, '_, 's>,
        application: LoadedProgram<'s>,
        found: FoundByLoad,
        then: Then<'_, 'a, R>,
    ) -> Result<R, Stage> {
        let options = self.options;
        let (host, request) = (project.host, project.request);
        let files = application.files();
        let in_parallel = self.parallel_runner();
        let mut steps = StepClock::new(Stage::Load);
        // It unlocks what the tests replace. Whoever reads a built-in of a file comes behind it.
        let contents = collect_program_contents(ContentsInput {
            files,
            options,
            found_entry_points: found.entry_points,
            any_file_may_become_main_module: host.may_any_file_become_main_module(),
            in_parallel: &in_parallel,
        });
        steps.end("contents of the program");
        let serves_unseen_code = options.can_load_code_at_run_time();
        #[cfg(test)]
        let serves_unseen_code = serves_unseen_code || self.keeps_library_code_without_names;
        let further = FurtherLibraryCode { serves_unseen_code };
        let roots = collect_runtime_roots(
            files,
            &contents,
            shared.runtime_modules,
            self.platform,
            further,
        );
        // A run that stays in its compiled files refuses every other code, so each way to such code has to be ruled out.
        // A file that loads again may have been written anew by then, and behind `resetModules()` the host reads it from disk.
        let mut compiled_files = files.compiled_files().iter();
        self.stays_in_compiled_files = options.aot.only_tests_load_code_from_disk
            && !options.can_load_code_at_run_time()
            && !contents.loads_by_unknown_path
            && !contents.any_module_loads_again
            && !contents.run.loads.reads_files_from_disk()
            && !roots.imports_uncompiled_code
            && !compiled_files.any(|&file| may_run_code_outside_image(files, file));
        let session = shared.sessions.runtime;
        let inputs = self.create_runtime_load_inputs(shared, session, &roots, &contents);
        let runtime_request = self.create_runtime_request(shared, &inputs, &roots.paths);
        let RuntimeLoadInputs {
            host: ref runtime_host,
            can_load_code_at_run_time,
            loads_code_by_unknown_names_alone,
            ..
        } = inputs;
        let input =
            self.create_freeze_input(shared, &application, None, &contents.found_entry_points);
        steps.end("roots of the library");
        let (frozen_application, runtime) = run_beside(
            &self.beside_runner(),
            || freeze_sources(&input, &in_parallel),
            || load_program(session, runtime_host, &runtime_request),
        );
        steps.end("freeze the application beside the load of the library");
        let runtime = self.finish_load(runtime, &runtime_request, shared.messages)?;
        let programs = PerProject {
            application: &application,
            runtime: &runtime,
        };
        let sources = self.freeze_projects(shared, programs, &roots, frozen_application)?;
        self.stop_if_errors(Stage::Load)?;
        steps.end("freeze the library, paths across the projects");
        if !options.aot.checks_only {
            self.started_workers.code = code_of_workers(&contents);
            self.started_workers.names =
                collect_entry_point_aliases(files, &sources.application, found.names_written);
        }
        steps.end("other names of entry points");
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
            atoms: shared.atoms,
            messages: shared.messages,
            builtin_names: shared.builtin_names,
            contents: &contents,
            can_load_code_at_run_time,
            loads_code_by_unknown_names_alone,
            keeps_library_code_without_names: roots.keeps_code_without_names,
            finish_asset_reads: project.finish_asset_reads,
        };
        then(self, loaded)
    }

    fn create_runtime_load_inputs<'c, 's>(
        &self,
        shared: &SharedLoadInputs<'c, 's>,
        session: &'s Session,
        roots: &RuntimeRoots,
        contents: &'c ProgramContents,
    ) -> RuntimeLoadInputs<'c, 's> {
        let options = self.options;
        // A name that the build does not know may be the path of a file on disk. Code that the build does not see may name the module too.
        let is_told_of_code = options.can_load_code_at_run_time() || roots.imports_uncompiled_code;
        let loads_code_by_unknown_names_alone =
            !is_told_of_code && contents.loads_by_unknown_path && options.aot.loads_code_from_disk;
        let can_load_code_at_run_time = is_told_of_code || loads_code_by_unknown_names_alone;
        RuntimeLoadInputs {
            fold: create_runtime_fold_inputs(
                shared.manifest,
                session.arena(),
                &shared.atoms,
                shared.messages,
                self.platform,
                ProgramFacts {
                    can_load_code_at_run_time,
                    can_load_addons_at_run_time: can_load_code_at_run_time
                        || (contents.loads_by_unknown_path
                            && (options.aot.only_tests_load_code_from_disk
                                || contents.embeds_addon_as_file)),
                    can_be_cluster_worker: roots.imports_cluster || can_load_code_at_run_time,
                    can_replace_builtins: !contents.replaced_builtins.is_empty(),
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
                replaced_builtins: &contents.replaced_builtins,
                messages: shared.messages,
                unreadable: Default::default(),
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

    fn load_application<'s>(
        &mut self,
        shared: &SharedLoadInputs<'_, 's>,
        project: &ApplicationLoad<'_, '_, '_, '_, 's>,
        request: &CompileRequest<'_, 's>,
    ) -> Result<LoadedProgram<'s>, Stage> {
        let result = load_program(shared.sessions.application, project.host, request);
        if !project.host.reads_in_background_after_load() {
            (project.finish_asset_reads)();
        }
        self.finish_load(result, request, shared.messages)
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

    /// `roots`: of Bun's own modules. `None`: `loaded` is the application, which alone has `found_entry_points`.
    fn create_freeze_input<'i, 's>(
        &self,
        shared: &SharedLoadInputs<'_, '_>,
        loaded: &'i LoadedProgram<'s>,
        roots: Option<&'i RuntimeRoots>,
        found_entry_points: &'i [FoundEntryPoint],
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
            found_entry_points,
        }
    }

    fn freeze_projects(
        &mut self,
        shared: &SharedLoadInputs<'_, '_>,
        programs: PerProject<&LoadedProgram<'_>>,
        roots: &RuntimeRoots,
        frozen_application: Result<FrozenSources, InternalError>,
    ) -> Result<PerProject<Sources>, Stage> {
        let in_parallel = self.parallel_runner();
        let application = self.finish_freeze(programs.application, frozen_application)?;
        let input = self.create_freeze_input(shared, programs.runtime, Some(roots), &[]);
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

    fn finish_freeze(
        &mut self,
        loaded: &LoadedProgram<'_>,
        frozen: Result<FrozenSources, InternalError>,
    ) -> Result<Sources, Stage> {
        let FrozenSources {
            sources,
            diagnostics,
        } = self.stop_at_internal_error(frozen)?;
        let view = ProgramView {
            loaded,
            sources: &sources,
        };
        self.diagnostics.add_buffer(view, diagnostics);
        Ok(sources)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compile::testing::{
        BUNDLED_LIBS, TestProject, default_settings, describe_messages, run_build,
        with_loaded_build,
    };
    use crate::load::source_provider::WithoutServices;
    use crate::statistics::LimitValues;
    use bun_ast::Log;
    use bun_sema::fold::{Constant, Decision};
    use bun_sema::hir::ExprKind;
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

    /// `bun test --aot`. The first file is the test file.
    fn stays_in_compiled_files(files: &[(&str, &str)]) -> bool {
        let mut project = TestProject::new(files, &default_settings());
        project.runs_tests = true;
        project.aot.loads_code_from_disk = true;
        project.aot.only_tests_load_code_from_disk = true;
        run_build(&project, BUNDLED_LIBS, &WithoutServices, |build| {
            build.with_loaded_projects(|build, _| Ok(build.stays_in_compiled_files))
        })
    }

    #[test]
    fn test_run_stays_in_its_compiled_files_unless_a_file_may_run_other_code() {
        const PLAIN: (&str, &str) = ("helper.cjs", "exports.mark = 1;");
        // What stands above the import in the test file, the helper that it imports, whether the run stays.
        let runs = [
            ("", PLAIN, true),
            (
                "",
                ("helper.cjs", r#"exports.mark = require("node:path").sep;"#),
                true,
            ),
            (
                "",
                (
                    "helper.mjs",
                    r#"import { createRequire } from "node:module"; export const mark = createRequire(import.meta.url)("node:path").sep;"#,
                ),
                true,
            ),
            (
                "",
                ("helper.cjs", r#"exports.mark = (0, eval)("1");"#),
                false,
            ),
            (
                "",
                (
                    "helper.cjs",
                    r#"exports.mark = new Function("p", "return import(p)");"#,
                ),
                false,
            ),
            (
                "",
                (
                    "helper.cjs",
                    r#"const Module = require("node:module"); Module._load = () => 1; exports.mark = 1;"#,
                ),
                false,
            ),
            (
                "",
                (
                    "helper.cjs",
                    r#"require.extensions[".mine"] = () => {}; exports.mark = 1;"#,
                ),
                false,
            ),
            (
                "",
                (
                    "helper.cjs",
                    r#"delete require.cache[__filename]; exports.mark = 1;"#,
                ),
                false,
            ),
            (
                r#"vi.mock("./helper.cjs", () => ({ mark: 2 }));"#,
                PLAIN,
                true,
            ),
            (r#"vi.mock("./helper.cjs");"#, PLAIN, false),
            (r#"await vi.importActual("./helper.cjs");"#, PLAIN, false),
            (r#"vi.resetModules();"#, PLAIN, false),
        ];
        let mut wrong = Vec::new();
        for (head, (helper, text), stays) in runs {
            let test_file = format!(
                "import {{ test, vi }} from \"bun:test\";\n{head}\nimport {{ mark }} from \"./{helper}\";\ntest(\"t\", () => console.log(mark));\n"
            );
            if stays_in_compiled_files(&[("a.test.ts", &test_file), (helper, text)]) != stays {
                wrong.push((head, text));
            }
        }
        assert!(wrong.is_empty(), "{wrong:#?}");
    }

    #[test]
    fn worker_that_starts_from_what_the_load_has_not_read_runs_unseen_code() {
        let rows = [
            ("export {};", CodeOfWorkers::NoneNamed),
            (
                r#"new Worker(new URL("./w.ts", import.meta.url));"#,
                CodeOfWorkers::Compiled,
            ),
            (
                r#"new Worker("data:text/javascript,postMessage(1)");"#,
                CodeOfWorkers::Unseen,
            ),
            (
                r#"new Worker(new URL("data:text/javascript,postMessage(1)"));"#,
                CodeOfWorkers::Unseen,
            ),
            (
                "export const start = (path: string) => new Worker(path);",
                CodeOfWorkers::Unseen,
            ),
            ("export const constructor = Worker;", CodeOfWorkers::Unseen),
        ];
        for (text, code) in rows {
            let files = [("main.ts", text), ("w.ts", "export {};")];
            let found = with_loaded_build(&files, &default_settings(), |build, _| {
                build.started_workers.code
            });
            assert_eq!(found, code, "{text}");
        }
    }

    #[test]
    fn function_of_a_file_on_a_circle_may_be_called_before_the_file_has_run() {
        // Behind its own first line `isOn` holds true. Whoever the file imports may call `load` in front of that.
        const ON_CIRCLE: &str = "import './back';\nvar isOn = true;\nexport function load() { if (!isOn) return import('./other'); }";
        let compiles_other_file = |back: &str| {
            let files = [
                ("main.ts", "import './cycle';"),
                ("cycle.ts", ON_CIRCLE),
                ("back.ts", back),
                ("other.ts", "export {};"),
            ];
            with_loaded_build(&files, &default_settings(), |_, loaded| {
                let files = loaded.project(ProjectId::Application).loaded.files();
                let other = files.by_path.get(b"/project/other.ts");
                other.is_some_and(|file| files.is_compiled(file))
            })
        };
        assert!(compiles_other_file("import './cycle';"));
        assert!(!compiles_other_file("export {};"));
    }

    #[test]
    fn alias_of_entry_point_names_one_file_and_is_the_path_of_no_module() {
        let files = [("main.ts", "import './other';"), ("other.ts", "export {};")];
        let paths = |public_path: &str, file_name: &str| EntryPointPaths {
            public_path: public_path.as_bytes().to_vec(),
            source_path: source_path_of(file_name.as_bytes()),
        };
        // The program begins at main.ts alone.
        let names_written = vec![
            paths("/$bunfs/root/worker", "/project/main.ts"),
            paths("/$bunfs/root/worker", "/project/main.ts"),
            paths("/$bunfs/root/shared", "/project/main.ts"),
            paths("/$bunfs/root/shared", "/project/other.ts"),
            paths("/$bunfs/root/other.ts", "/project/main.ts"),
            paths("/$bunfs/root/imported", "/project/other.ts"),
        ];
        let aliases = with_loaded_build(&files, &default_settings(), |_, loaded| {
            let application = loaded.project(ProjectId::Application);
            let files = application.loaded.files();
            collect_entry_point_aliases(files, &application.sources, names_written)
        });
        assert_eq!(aliases, [paths("/$bunfs/root/worker", "/project/main.ts")]);
        assert!(is_path_of_module(
            b"B:\\~BUN\\root\\a.js",
            b"B:/~BUN/root/a.js"
        ));
        assert!(!is_path_of_module(b"/$bunfs/root/a.js", b"/$bunfs/root/a"));
    }
}
