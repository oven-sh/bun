use super::{Build, LoadedBuild, LoadedProject, ProgramPlace};
use crate::builtins::{BuiltinNames, RuntimeModule};
use crate::diagnostics::{Diagnostics, LoadMessages, ProgramView};
use crate::load::fold_inputs::{
    ApplicationFoldRequest, ProgramFacts, RuntimeFoldRequest, create_application_fold_inputs,
    create_runtime_fold_inputs,
};
use crate::load::host::{LoadHost, LoadHostInput, create_disk};
use crate::load::named_loads::resolve_loads_through_imported_loaders;
use crate::load::runtime_host::{RuntimeHost, RuntimeHostInput};
use crate::load::runtime_modules::RuntimeModules;
use crate::load::runtime_roots::collect_runtime_roots;
use crate::load::sources::{
    FreezeInput, FrozenSources, check_unique_paths_across_projects, freeze_sources,
};
use crate::load::typed_packages::TypedPackages;
use crate::load::{PerProject, ProjectId, Sources};
use crate::options::Options;
use crate::package_diagnostics::{PackageView, report_rejected_versions};
use crate::statistics::{LimitId, LimitValues, Stage, StatisticId, Statistics};
use bun_builtin_sources::{Archive, Manifest, VIRTUAL_ROOT};
use bun_sema::atom::Interner;
use bun_sema::check::aot::FileOrigin;
use bun_sema::fold::{Constant, Define, DefinePath, DefineRoot, DefineValue, FoldInputs};
use bun_sema::program::MainModule;
use bun_sema::resolve::{CodeHost, CodeOptions};
use bun_sema::session::Session;
use bun_sema_driver::host::{Disk, from_native};
use bun_sema_driver::{CompileRequest, EntryPoints, LoadFailure, LoadedProgram, load_program};
use bun_threading::Guarded;
use std::cell::Cell;
use std::mem::take;
use std::thread::Scope;
use std::time::Instant;

const MAX_ASSET_READERS: usize = 64;

/// What plugins make of the assets is needed when the executable is written. A plugin can take seconds for one.
#[derive(Copy, Clone, PartialEq, Eq)]
enum AssetReads {
    FinishedByLoad,
    /// They go on while `then` runs, which calls `LoadedBuild::finish_asset_reads`.
    FinishedLater,
}

type Then<'t, 'a, R> =
    &'t mut dyn for<'b, 's> FnMut(&mut Build<'a>, LoadedBuild<'b, 's>) -> Result<R, Stage>;

struct AssetReaders<'scope, 'env, 'h> {
    scope: &'scope Scope<'scope, 'env>,
    host: &'scope LoadHost<'h>,
    paths: std::sync::Arc<Guarded<Vec<Vec<u8>>>>,
}

impl<'scope> AssetReaders<'scope, '_, '_> {
    // Each reader starts the next: the calling thread pays for one thread.
    fn start(self, count: usize) {
        if count == 0 {
            return;
        }
        let thread = std::thread::Builder::new()
            .stack_size(bun_threading::thread_pool::DEFAULT_THREAD_STACK_SIZE as usize);
        let _ = thread.spawn_scoped(self.scope, move || {
            bun_core::Output::Source::configure_named_thread(bun_core::zstr!("Plugin"));
            let (host, paths) = (self.host, std::sync::Arc::clone(&self.paths));
            self.start(count - 1);
            loop {
                let Some(path) = paths.lock().pop() else {
                    return;
                };
                host.read_in_background(&path);
            }
        });
    }
}

fn read_assets<'scope>(scope: &'scope Scope<'scope, '_>, host: &'scope LoadHost<'_>) {
    let paths = host.background_reads();
    let count = paths.len().min(MAX_ASSET_READERS);
    let paths = std::sync::Arc::new(Guarded::new(paths));
    AssetReaders { scope, host, paths }.start(count);
}

struct ApplicationLoad<'l, 'scope, 'env, 'h, 's> {
    host: &'scope LoadHost<'h>,
    request: &'l CompileRequest<'l, 's>,
    scope: &'scope Scope<'scope, 'env>,
    asset_reads: AssetReads,
    finish_asset_reads: &'l dyn Fn() -> bool,
}

struct SharedLoadInputs<'c, 's> {
    disk: &'c Disk,
    sessions: PerProject<&'s Session>,
    world_sessions: &'s [Session],
    atoms: Interner<'s>,
    application_fold: &'c FoldInputs<'s>,
    application_defines: &'s [Define<'s>],
    builtin_names: &'c BuiltinNames,
    manifest: &'static Manifest,
    runtime_modules: &'c RuntimeModules,
    messages: &'c LoadMessages,
    typed_packages: &'c TypedPackages<'c>,
}

impl<'a> Build<'a> {
    pub(crate) fn with_loaded_projects<R>(
        &mut self,
        then: impl for<'b, 's> FnOnce(&mut Build<'a>, LoadedBuild<'b, 's>) -> Result<R, Stage>,
    ) -> Result<R, Stage> {
        let mut then = Some(then);
        self.load_in_new_sessions(AssetReads::FinishedByLoad, &mut |build, loaded| {
            (then.take().expect("the program is loaded once"))(build, loaded)
        })
    }

    /// `with_loaded_projects` that doesn't wait for the plugins' answers about assets. See `AssetReads::FinishedLater`.
    pub(crate) fn with_loaded_projects_before_assets<R>(
        &mut self,
        mut then: impl for<'b, 's> FnMut(&mut Build<'a>, LoadedBuild<'b, 's>) -> Result<R, Stage>,
    ) -> Result<R, Stage> {
        self.load_in_new_sessions(AssetReads::FinishedLater, &mut then)
    }

    fn load_in_new_sessions<R>(
        &mut self,
        asset_reads: AssetReads,
        then: Then<'_, 'a, R>,
    ) -> Result<R, Stage> {
        let sessions = PerProject {
            application: Session::new(),
            runtime: Session::new(),
        };
        let world_sessions: Vec<Session> = (0..64).map(|_| Session::new()).collect();
        let result = self.load_in_sessions(sessions.as_ref(), &world_sessions, asset_reads, then);
        self.retire_sessions(sessions);
        self.retire_world_sessions(world_sessions);
        result
    }

    fn load_in_sessions<R>(
        &mut self,
        sessions: PerProject<&Session>,
        world_sessions: &[Session],
        asset_reads: AssetReads,
        then: Then<'_, 'a, R>,
    ) -> Result<R, Stage> {
        self.clock.start(Stage::Load);
        let options = self.options;
        let disk = create_disk(options, self.threads);
        let application_session = sessions.application;
        let atoms = Interner::new_in(application_session);
        let builtin_names = BuiltinNames::new(&atoms);
        let archive = Archive::embedded();
        let runtime_modules = RuntimeModules::new(archive, options.load.omits_builtin_modules)
            .with_test_aliases(options.load.runs_tests);
        #[cfg(test)]
        let runtime_modules = runtime_modules.with_replaced_sources(&options.load.in_memory_files);
        let messages = LoadMessages::default();
        let typed_packages = TypedPackages::new(&disk, &from_native(&options.load.project_root));
        let provided = messages.with_log(|log| {
            self.provider
                .fold_options(application_session.arena(), &atoms, log)
        });
        let application_fold = create_application_fold_inputs(&ApplicationFoldRequest {
            provided,
            arena: application_session.arena(),
            atoms: &atoms,
            limits: &self.limits,
            platform: self.platform,
        });
        let shared = SharedLoadInputs {
            disk: &disk,
            sessions,
            world_sessions,
            atoms,
            application_fold: &application_fold,
            application_defines: provided.defines,
            builtin_names: &builtin_names,
            manifest: archive.manifest(),
            runtime_modules: &runtime_modules,
            messages: &messages,
            typed_packages: &typed_packages,
        };
        let result = self.load_projects(&shared, asset_reads, then);
        drop(typed_packages);
        self.retire(Box::new(disk));
        result
    }

    pub(super) fn reports_typed_versions(&self, project: ProjectId) -> bool {
        match project {
            ProjectId::Application => !self.options.aot.runs_in_place,
            ProjectId::Runtime => false,
        }
    }

    fn load_projects<R>(
        &mut self,
        shared: &SharedLoadInputs<'_, '_>,
        asset_reads: AssetReads,
        then: Then<'_, 'a, R>,
    ) -> Result<R, Stage> {
        let options = self.options;
        let code = application_code_options(options, &self.limits);
        let limits = self.limits.clone();
        let defined =
            |path: &[u8]| find_defined_string(shared.application_defines, &shared.atoms, path);
        let host = LoadHost::new(LoadHostInput {
            disk: shared.disk,
            provider: self.provider,
            options,
            runtime_modules: shared.runtime_modules,
            messages: shared.messages,
            builtin_names: shared.builtin_names,
            typed_packages: shared.typed_packages,
            defined: &defined,
            platform: self.platform,
            limits: &limits,
        });
        let host = match asset_reads {
            AssetReads::FinishedByLoad => host,
            AssetReads::FinishedLater => host.reading_in_background_after_load(),
        };
        let request = CompileRequest {
            entry_points: match self.place {
                ProgramPlace::Only => EntryPoints::Written(&options.entry_points),
                ProgramPlace::OneOfSeveral(_) => EntryPoints::WrittenFor(
                    &options.entry_points,
                    MainModule::EntryPointOfProcessOrWorker,
                ),
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
        std::thread::scope(|scope| {
            loop {
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
                };
                let result = self.load_projects_once(shared, project, then);
                if finish_asset_reads() {
                    if asset_reads == AssetReads::FinishedLater {
                        self.diagnostics.add_load_messages(shared.messages);
                    }
                    return result;
                }
                drop(result);
                self.provider.clear_embedded_files();
                self.diagnostics = Diagnostics::new();
                self.statistics = Statistics::default();
            }
        })
    }

    #[allow(clippy::needless_pass_by_value)] // taken apart
    fn load_projects_once<R>(
        &mut self,
        shared: &SharedLoadInputs<'_, '_>,
        project: ApplicationLoad<'_, '_, '_, '_, '_>,
        then: Then<'_, 'a, R>,
    ) -> Result<R, Stage> {
        let options = self.options;
        let ApplicationLoad {
            host,
            request,
            scope,
            asset_reads,
            finish_asset_reads,
        } = project;
        let session = shared.sessions.application;
        let application = self.load_application(session, host, request, shared.messages)?;
        if asset_reads == AssetReads::FinishedLater {
            read_assets(scope, host);
        }
        self.keep_import_graph(application.files());
        resolve_loads_through_imported_loaders(application.files());

        let started = Instant::now();
        let roots =
            collect_runtime_roots(application.files(), shared.runtime_modules, self.platform);
        // Code that the build does not see may name the module too.
        let can_load_code_at_run_time =
            options.can_load_code_at_run_time() || roots.imports_uncompiled_code;
        let runtime_fold = create_runtime_fold_inputs(&RuntimeFoldRequest {
            manifest: shared.manifest,
            arena: shared.sessions.runtime.arena(),
            atoms: &shared.atoms,
            messages: shared.messages,
            limits: &self.limits,
            platform: self.platform,
            facts: ProgramFacts {
                can_load_code_at_run_time,
                can_be_cluster_worker: roots.imports_cluster || can_load_code_at_run_time,
            },
        });
        let runtime_code = runtime_code_options(&self.limits);
        let runtime_host = RuntimeHost::new(RuntimeHostInput {
            disk: shared.disk,
            runtime_modules: shared.runtime_modules,
            builtin_names: shared.builtin_names,
            platform: self.platform,
            messages: shared.messages,
        });
        let runtime_request = CompileRequest {
            entry_points: EntryPoints::Resolved(&roots.paths),
            code: &runtime_code,
            fold: &runtime_fold,
            atoms: shared.atoms,
            libs: options.typescript_libs,
            project_origin: FileOrigin::Runtime,
            threads: self.threads,
            progress: None,
            left_out_bodies: None,
        };
        let session = shared.sessions.runtime;
        let runtime =
            self.load_project(session, &runtime_host, &runtime_request, shared.messages)?;
        self.count_time(StatisticId::LoadRuntimeProjectNanoseconds, started);

        let programs = PerProject {
            application: &application,
            runtime: &runtime,
        };
        let sources = self.freeze_projects(shared, programs, &roots.host_loaded_modules)?;
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
                host: &runtime_host,
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
            typed_packages: shared.typed_packages,
            can_load_code_at_run_time,
            finish_asset_reads,
        };
        then(self, loaded)
    }

    fn load_application<'s>(
        &mut self,
        session: &'s Session,
        host: &LoadHost<'_>,
        request: &CompileRequest<'_, 's>,
        messages: &LoadMessages,
    ) -> Result<LoadedProgram<'s>, Stage> {
        let mut result = load_program(session, host, request);
        if !host.reads_in_background_after_load()
            && !host.finish_background_reads()
            && result.is_ok()
            && !messages.has_errors()
        {
            drop(result);
            self.provider.clear_embedded_files();
            result = load_program(session, host, request);
        }
        self.finish_load(result, request, messages)
    }

    fn load_project<'s>(
        &mut self,
        session: &'s Session,
        host: &dyn CodeHost,
        request: &CompileRequest<'_, 's>,
        messages: &LoadMessages,
    ) -> Result<LoadedProgram<'s>, Stage> {
        let result = load_program(session, host, request);
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
                    EntryPoints::Resolved(paths) | EntryPoints::Configured(paths, _) => paths,
                };
                self.diagnostics
                    .add_load_failure(failure, entry_point_names);
                Err(Stage::Load)
            }
        }
    }

    fn freeze_projects(
        &mut self,
        shared: &SharedLoadInputs<'_, '_>,
        programs: PerProject<&LoadedProgram<'_>>,
        host_loaded_modules: &[RuntimeModule],
    ) -> Result<PerProject<Sources>, Stage> {
        let mut freeze = |project: ProjectId, host_loaded_modules: &[RuntimeModule]| {
            let loaded = *programs.get(project);
            let input = FreezeInput {
                project,
                files: loaded.files(),
                options: self.options,
                manifest: shared.manifest,
                host_loaded_modules,
                is_world: false,
            };
            self.freeze_project(loaded, &input, shared)
        };
        let sources = PerProject {
            application: freeze(ProjectId::Application, &[])?,
            runtime: freeze(ProjectId::Runtime, host_loaded_modules)?,
        };
        let frozen = sources.as_ref();
        let frozen = frozen.map(|project, sources| (programs.get(project).files(), sources));
        if let Err(error) = check_unique_paths_across_projects(frozen) {
            self.diagnostics.add_internal_error(error);
            return Err(Stage::Load);
        }
        Ok(sources)
    }

    /// The sources of a program that checks a typed package by itself. The application reports what is wrong with them.
    pub(crate) fn freeze_world(&mut self, loaded: &LoadedProgram<'_>) -> Result<Sources, Stage> {
        let input = FreezeInput {
            project: ProjectId::Application,
            files: loaded.files(),
            options: self.options,
            manifest: Archive::embedded().manifest(),
            host_loaded_modules: &[],
            is_world: true,
        };
        match freeze_sources(&input, &self.parallel_runner()) {
            Ok(frozen) => Ok(frozen.sources),
            Err(error) => {
                self.diagnostics.add_internal_error(error);
                Err(Stage::Load)
            }
        }
    }

    fn freeze_project(
        &mut self,
        loaded: &LoadedProgram<'_>,
        input: &FreezeInput<'_, '_>,
        shared: &SharedLoadInputs<'_, '_>,
    ) -> Result<Sources, Stage> {
        let FrozenSources {
            sources,
            diagnostics,
            counters,
        } = match freeze_sources(input, &self.parallel_runner()) {
            Ok(frozen) => frozen,
            Err(error) => {
                self.diagnostics.add_internal_error(error);
                return Err(Stage::Load);
            }
        };
        let view = ProgramView {
            loaded,
            sources: &sources,
        };
        self.diagnostics.add_buffer(view, diagnostics);
        for &file in view.files().compiled_files() {
            self.diagnostics.add_fold_errors(view, file);
        }
        self.statistics.add_counters(view, counters);
        if self.reports_typed_versions(input.project) {
            let packages = PackageView {
                view,
                packages: shared.typed_packages,
            };
            let defined =
                |path: &[u8]| find_defined_string(shared.application_defines, &shared.atoms, path);
            self.full_types_refused_at_load =
                report_rejected_versions(&mut self.diagnostics, packages, &defined);
        }
        Ok(sources)
    }
}

fn dotted_path(path: DefinePath<'_>, atoms: &Interner<'_>) -> Vec<u8> {
    let root: &[u8] = match path.root {
        DefineRoot::Global(name) => atoms.bytes(name),
        DefineRoot::ImportMeta => b"import.meta",
    };
    let mut text = root.to_vec();
    for &member in path.members {
        text.push(b'.');
        text.extend_from_slice(atoms.bytes(member));
    }
    text
}

fn find_defined_string(
    defines: &[Define<'_>],
    atoms: &Interner<'_>,
    path: &[u8],
) -> Option<Vec<u8>> {
    let define = defines
        .iter()
        .rfind(|define| dotted_path(define.path, atoms) == path)?;
    match define.value {
        DefineValue::Constant(Constant::String(text)) => Some(atoms.bytes(text).to_vec()),
        DefineValue::Constant(
            Constant::Undefined
            | Constant::Null
            | Constant::Boolean(_)
            | Constant::Number(_)
            | Constant::BigInt(_),
        )
        | DefineValue::GlobalPath(_)
        | DefineValue::Data(_)
        | DefineValue::RuntimeValue(_) => None,
    }
}

fn max_computed_candidates(limits: &LimitValues) -> u32 {
    let limit = limits.get(LimitId::MaxComputedSpecifierCandidates);
    u32::try_from(limit).unwrap_or(u32::MAX)
}

fn application_code_options(options: &Options<'_>, limits: &LimitValues) -> CodeOptions {
    CodeOptions {
        max_computed_candidates: max_computed_candidates(limits),
        ..options.code.clone()
    }
}

fn runtime_code_options(limits: &LimitValues) -> CodeOptions {
    let working_directory = VIRTUAL_ROOT.strip_suffix(b"/").unwrap_or(VIRTUAL_ROOT);
    CodeOptions {
        typed_condition: None,
        tsconfig_override: Some([VIRTUAL_ROOT, b"tsconfig.json"].concat()),
        max_computed_candidates: max_computed_candidates(limits),
        ..CodeOptions::bun_run(working_directory)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compile::testing::{BUNDLED_LIBS, TestProject, default_settings, describe_messages};
    use crate::load::source_provider::WithoutServices;
    use bun_ast::Log;
    use bun_sema::atom::Atom;
    use bun_sema::fold::Decision;
    use bun_sema::hir::{ExprId, ExprKind};
    use bun_sema_driver::ThreadCaches;

    fn define<'s>(
        root: DefineRoot,
        members: &[&[u8]],
        value: DefineValue<'s>,
        session: &'s Session,
        atoms: &Interner<'s>,
    ) -> Define<'s> {
        let members: Vec<Atom> = members.iter().map(|name| atoms.intern(name)).collect();
        Define {
            path: DefinePath {
                root,
                members: session.arena().alloc_slice_copy(&members),
            },
            value,
        }
    }

    fn string(text: &[u8], atoms: &Interner<'_>) -> DefineValue<'static> {
        DefineValue::Constant(Constant::String(atoms.intern(text)))
    }

    #[test]
    fn string_define_is_found_by_dotted_path() {
        let session = Session::new();
        let atoms = Interner::new_in(&session);
        let global = |name: &[u8]| DefineRoot::Global(atoms.intern(name));
        let defines = [
            define(
                global(b"process"),
                &[b"env", b"NODE_ENV"],
                string(b"production", &atoms),
                &session,
                &atoms,
            ),
            define(
                global(b"MODE"),
                &[],
                string(b"test", &atoms),
                &session,
                &atoms,
            ),
            define(
                DefineRoot::ImportMeta,
                &[b"env", b"MODE"],
                string(b"server", &atoms),
                &session,
                &atoms,
            ),
        ];
        let find = |path: &[u8]| find_defined_string(&defines, &atoms, path);
        assert_eq!(find(b"process.env.NODE_ENV"), Some(b"production".to_vec()));
        assert_eq!(find(b"MODE"), Some(b"test".to_vec()));
        assert_eq!(find(b"import.meta.env.MODE"), Some(b"server".to_vec()));
        for path in [
            &b""[..],
            b"process",
            b"process.env",
            b"process.env.NODE_ENV.length",
            b"env.NODE_ENV",
            b"NODE_ENV",
            b"env.MODE",
        ] {
            assert_eq!(find(path), None, "{}", path.escape_ascii());
        }
    }

    #[test]
    fn later_define_of_same_path_wins() {
        let session = Session::new();
        let atoms = Interner::new_in(&session);
        let mode = DefineRoot::Global(atoms.intern(b"MODE"));
        let of = |value| define(mode, &[], value, &session, &atoms);
        let find = |defines: &[Define<'_>]| find_defined_string(defines, &atoms, b"MODE");
        let (first, second) = (string(b"first", &atoms), string(b"second", &atoms));
        assert_eq!(find(&[of(first), of(second)]), Some(b"second".to_vec()));
        let no_string = DefineValue::Constant(Constant::Boolean(true));
        assert_eq!(find(&[of(first), of(no_string)]), None);
    }

    #[test]
    fn define_of_other_value_is_no_string() {
        let session = Session::new();
        let atoms = Interner::new_in(&session);
        let mode = DefineRoot::Global(atoms.intern(b"MODE"));
        let renamed: &[Atom] = session.arena().alloc_slice_copy(&[atoms.intern(b"OTHER")]);
        for value in [
            DefineValue::Constant(Constant::Undefined),
            DefineValue::Constant(Constant::Null),
            DefineValue::Constant(Constant::Boolean(true)),
            DefineValue::Constant(Constant::Number(1.0)),
            DefineValue::Constant(Constant::BigInt(atoms.intern(b"1"))),
            DefineValue::GlobalPath(renamed),
        ] {
            let defines = [define(mode, &[], value, &session, &atoms)];
            assert_eq!(
                find_defined_string(&defines, &atoms, b"MODE"),
                None,
                "{value:?}"
            );
        }
    }

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
