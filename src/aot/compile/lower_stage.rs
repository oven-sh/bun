use super::runtime_reach::{ReachInput, find_reached_runtime_code};
use super::{BoundApplication, BoundBuild, BoundProject, Build, LoadedBuild, LoadedProject};
use crate::diagnostics::{DiagnosticBuffer, InternalError, ProgramView};
use crate::ir::generated::FunctionRole;
use crate::ir::{FunctionId, FunctionKey, Id};
use crate::link::{KeyContext, LinkUnit, Rehoming};
use crate::load::sources::parsed_source;
use crate::load::{PerProject, ProjectId, Sources};
use crate::lower::{
    DefinedObjectTypes, FileInputs, LibraryFunctions, LoweredFile, LoweringInputs, LoweringOptions,
    lower_file,
};
use crate::modules::{ApplicationGraph, Library, LinkedProject, ModuleGraph, ModuleRef, Shape};
use crate::package_diagnostics::report_package_errors;
use crate::report;
use crate::statistics::{Counters, Stage, StatisticId};
use bun_core::current_work;
use bun_sema::atom::known;
use bun_sema::check::aot::{
    DiagnosticClass, FileOrigin, FunctionRef, LeftOutBodies, QueryStatistics,
};
use bun_sema::config;
use bun_sema::hir::DiagnosticKind;
use bun_sema::program::{FileId, FileRole, Files};
use bun_sema::session::Session;
use bun_sema_driver::{
    self as driver, BuildDiagnostic, CheckedProgram, CompileRequest, Demotion, EntryPoints,
    Incomplete, RoleDecision, decide_roles, keep_verified_roles, run_on_one_thread_while,
};
use rustc_hash::{FxHashMap, FxHashSet};
use std::borrow::Cow;
use std::collections::BTreeMap;
use std::num::NonZeroUsize;

pub(crate) struct LoweredUnit {
    // A unit is a large record, and the list of what was lowered is copied and put in order on one thread.
    pub unit: Box<LinkUnit>,
    pub diagnostics: DiagnosticBuffer,
    pub counters: Counters,
    pub queries: QueryStatistics,
}

struct DecidedProject {
    roles: RoleDecision,
    files_to_lower: Vec<FileId>,
    left_out_bodies: LeftOutBodies,
}

struct WorldToLower<'a, 's> {
    session: &'s Session,
    index: usize,
    config_path: Option<&'a [u8]>,
    // Of the application.
    files: &'a [FileId],
}

/// What the programs of the typed packages have done. The files are the application's.
#[derive(Default)]
struct Worlds {
    // In order.
    lowered: Vec<FileId>,
    units: Vec<LinkUnit>,
    demoted: Vec<Demotion>,
}

struct ProjectToLower<'a, 'b, 's> {
    loaded: &'a LoadedProject<'b, 's>,
    decided: &'a DecidedProject,
    keys: KeyContext<'a>,
    inputs: &'a LoweringInputs<'a>,
    threads: NonZeroUsize,
    // --aot-sabotage=LoweringPanics
    panics: bool,
}

impl<'a, 'b, 's> ProjectToLower<'a, 'b, 's> {
    fn new(
        loaded: &'a LoadedBuild<'b, 's>,
        bound: &'a BoundBuild<'_>,
        decided: &'a PerProject<DecidedProject>,
        project: ProjectId,
        inputs: &'a LoweringInputs<'a>,
        threads: NonZeroUsize,
    ) -> ProjectToLower<'a, 'b, 's> {
        ProjectToLower {
            loaded: loaded.project(project),
            decided: decided.get(project),
            keys: KeyContext {
                project,
                graph: &bound.projects.get(project).graph,
                runtime_sources: &loaded.project(ProjectId::Runtime).sources,
                rehoming: None,
            },
            inputs,
            threads,
            panics: false,
        }
    }

    fn lower(&self) -> CheckedProgram<Option<LoweredUnit>> {
        let request = &CompileRequest {
            threads: self.threads,
            left_out_bodies: Some(&self.decided.left_out_bodies),
            ..*self.loaded.request
        };
        driver::check_and_lower_noting_commits(
            self.loaded.loaded,
            self.loaded.host,
            request,
            &self.decided.roles,
            &self.decided.files_to_lower,
            &|checker, file| {
                let path = self.loaded.loaded.files().module(file).file_name();
                let _work = current_work::working_on(current_work::Step::Lower, path);
                assert!(!self.panics, "--aot-sabotage=LoweringPanics");
                if !is_well_formed(self.loaded.loaded.files(), file)
                    || checker.found_early_error(file)
                {
                    return Some(None);
                }
                let lowered = lower_file(self.inputs, checker, file)?;
                let functions = self.inputs.library_functions;
                Some(Some(finish_lowered_file(&self.keys, functions, lowered)))
            },
            &|file, lowered| {
                let Some(lowered) = lowered else {
                    return;
                };
                for (ty, level) in lowered.unit.defined_object_types() {
                    self.inputs
                        .defined_object_types
                        .add_definition(ty, level, file);
                }
                self.inputs.defined_object_types.publish_names_of_file(file);
            },
        )
    }
}

impl Build<'_> {
    pub(crate) fn check_and_lower(
        &mut self,
        loaded: &LoadedBuild<'_, '_>,
        bound: &BoundBuild<'_>,
    ) -> Vec<LinkUnit> {
        let worlds = self.lower_worlds(loaded, &bound.projects.application);
        self.checked_elsewhere.clone_from(&worlds.lowered);
        self.clock.start(Stage::Check);
        let mut decided = loaded.projects.as_ref().map(|id, project| {
            let all_compiled_files = project.loaded.files().compiled_files();
            let is_decided = |file: &FileId| {
                id == ProjectId::Application
                    && (worlds.lowered.binary_search(file).is_ok()
                        || worlds.demoted.iter().any(|demotion| demotion.file == *file))
            };
            let undecided_files: Vec<FileId> = (all_compiled_files.iter().copied())
                .filter(|file| !is_decided(file))
                .collect();
            let compiled_files = &undecided_files[..];
            let left_out = &bound.projects.get(id).left_out;
            let left_out_bodies = LeftOutBodies::new(left_out.functions.iter().copied())
                .with_files(left_out.files.iter().copied());
            let mut roles = match id {
                ProjectId::Application => {
                    let request = &CompileRequest {
                        left_out_bodies: Some(&left_out_bodies),
                        ..*project.request
                    };
                    decide_roles(project.loaded, project.host, request, compiled_files)
                }
                // Bun's own modules keep their roles whatever type errors they have: lowering asks for each conversion whether
                // the checker accepts it. The test `every_module_of_bun_keeps_its_types` lists the errors.
                ProjectId::Runtime => keep_verified_roles(project.loaded, compiled_files),
            };
            if id == ProjectId::Application {
                for &demotion in &worlds.demoted {
                    roles.roles[demotion.file.idx()] = FileRole::Inferred;
                    roles.demoted.push(demotion);
                }
                roles.demoted.sort_by_key(|demotion| demotion.file);
            }
            let mut files_to_lower = find_files_to_lower(all_compiled_files, &roles);
            files_to_lower.retain(|file| {
                id != ProjectId::Application || worlds.lowered.binary_search(file).is_err()
            });
            files_to_lower.retain(|file| left_out.files.binary_search(file).is_err());
            DecidedProject {
                roles,
                files_to_lower,
                left_out_bodies,
            }
        });
        self.count_aot_sources(loaded, &decided.application.roles);
        let reach_input = ReachInput {
            application: loaded.project(ProjectId::Application).loaded.files(),
            application_graph: &bound.projects.application.graph,
            runtime: loaded.project(ProjectId::Runtime).loaded.files(),
            sources: &loaded.project(ProjectId::Runtime).sources,
            graph: &bound.projects.runtime.graph,
            names: loaded.builtin_names,
            platform: self.platform,
            can_load_code_at_run_time: loaded.can_load_code_at_run_time
                && !(loaded.loads_code_by_unknown_names_alone
                    && bound
                        .projects
                        .application
                        .left_out
                        .holds_every_load_by_unknown_name),
        };
        let reached = find_reached_runtime_code(&reach_input, &self.parallel_runner());
        let files_to_lower = &mut decided.runtime.files_to_lower;
        let unreached = files_to_lower
            .iter()
            .copied()
            .filter(|&file| !reached.is_file_reached(file));
        self.unreached_runtime_files = unreached.collect();
        self.unreached_runtime_files.sort_unstable();
        files_to_lower.retain(|&file| reached.is_file_reached(file));

        self.clock.start(Stage::Lower);
        let left_out = PerProject {
            application: bound.projects.application.left_out.functions.clone(),
            runtime: reached.left_out_functions,
        };
        let mut checked = self.lower_projects(loaded, bound, &decided, left_out);
        let files = loaded.project(ProjectId::Application).loaded.files();
        drop_reports_on_unloadable_modules(
            files,
            &bound.projects.application.graph,
            &mut checked.application,
        );
        let unit_count =
            checked.application.lowered.len() + checked.runtime.lowered.len() + worlds.units.len();
        let mut units = Vec::with_capacity(unit_count);
        checked.map(|project, checked| {
            self.report_project(loaded, project, &decided, checked, &mut units);
        });
        units.extend(worlds.units);
        units
    }

    /// The files under "aot" conditions that are compiled with their types. One that lost them to a type error does not count.
    fn count_aot_sources(&mut self, loaded: &LoadedBuild<'_, '_>, roles: &RoleDecision) {
        let files = loaded.project(ProjectId::Application).loaded.files();
        let typed = (files.compiled_files().iter())
            .filter(|&&file| files.compiled(file).is_some_and(|it| it.is_aot_source))
            .filter(|&&file| roles.role(file) == FileRole::Checked);
        let count = typed.count() as u64;
        self.statistics.count(StatisticId::TypedVersionsUsed, count);
    }

    /// A typed package is checked and lowered by a program of its own, under the `compilerOptions` of its `package.json`.
    /// Nothing of the application's configuration reaches it. Packages that say the same share one.
    fn lower_worlds(&mut self, loaded: &LoadedBuild<'_, '_>, bound: &BoundProject<'_>) -> Worlds {
        let left_out = &bound.left_out;
        let application = loaded.project(ProjectId::Application);
        let (files, host) = (application.loaded.files(), application.host);
        let mut groups: BTreeMap<Vec<u8>, (Option<Vec<u8>>, Vec<FileId>)> = BTreeMap::new();
        let mut by_directory: FxHashMap<Vec<u8>, (Vec<u8>, Option<Vec<u8>>)> = FxHashMap::default();
        for &file in files.compiled_files() {
            if !files.compiled(file).is_some_and(|it| it.is_aot_source)
                || application.loaded.origin(file) != FileOrigin::DependencySource
                || files.role(file) != FileRole::Checked
                || bound.graph.shape(ModuleRef::File(file)) == Shape::AsToday
                || files.entry_points().contains(&file)
                || files.hir(file).check_directive == Some(false)
                || left_out.files.binary_search(&file).is_ok()
            {
                continue;
            }
            let directory = host
                .directory_of(files.module(file).file_name())
                .into_owned();
            let (key, manifest_path) = by_directory.entry(directory).or_insert_with_key(|it| {
                let manifest_path = config::find_package_with_compiler_options(host, it);
                let project = (manifest_path.as_ref())
                    .map(|path| config::load_for_aot_package(host, &Session::new(), path));
                let key = project.map(|project| project.key_of_compiler_options());
                (key.unwrap_or_default(), manifest_path)
            });
            let group = groups.entry(key.clone());
            let group = group.or_insert_with(|| (manifest_path.clone(), Vec::new()));
            group.1.push(file);
        }
        let mut worlds = Worlds::default();
        for (index, (config_path, group)) in groups.into_values().enumerate() {
            let Some(session) = loaded.world_sessions.get(index) else {
                break;
            };
            let world = WorldToLower {
                session,
                index,
                config_path: config_path.as_deref(),
                files: &group,
            };
            self.lower_world(loaded, bound, &world, &mut worlds);
        }
        worlds.lowered.sort_unstable();
        worlds
    }

    fn lower_world<'s>(
        &mut self,
        loaded: &LoadedBuild<'_, 's>,
        bound_application: &BoundProject<'_>,
        world: &WorldToLower<'_, 's>,
        worlds: &mut Worlds,
    ) {
        let application = loaded.project(ProjectId::Application);
        let runtime = loaded.project(ProjectId::Runtime);
        let files = application.loaded.files();
        let paths: Vec<Vec<u8>> = (world.files.iter())
            .map(|&file| files.module(file).file_name().to_vec())
            .collect();
        let request = CompileRequest {
            entry_points: EntryPoints::Configured(&paths, world.config_path),
            project_origin: FileOrigin::DependencySource,
            left_out_bodies: None,
            ..*application.request
        };
        // The application's program goes on with the files of a program that does not load.
        let Ok(program) = driver::load_program(world.session, application.host, &request) else {
            return;
        };
        let world_files = program.files();
        let to_application: Vec<Option<FileId>> = (0..world_files.modules.len())
            .map(|index| {
                files
                    .by_path
                    .get(world_files.module(FileId(index as u32)).file_name())
            })
            .collect();
        let mut to_world: FxHashMap<FileId, FileId> = FxHashMap::default();
        for (index, &file) in to_application.iter().enumerate() {
            if let Some(file) = file {
                to_world.insert(file, FileId(index as u32));
            }
        }
        let Ok(sources) = self.freeze_world(&program) else {
            return;
        };
        let bound_application = BoundApplication {
            graph: ApplicationGraph {
                graph: &bound_application.graph,
                to_local: &|file| to_world.get(&file).copied(),
                to_application: &|file| to_application[file.idx()],
            },
            left_out: &bound_application.left_out,
        };
        let world_build = LoadedBuild {
            projects: PerProject {
                application: LoadedProject {
                    loaded: &program,
                    host: application.host,
                    request: &request,
                    sources,
                },
                runtime: runtime.clone(),
            },
            world_sessions: &[],
            application: Some(&bound_application),
            session: world.session,
            atoms: loaded.atoms,
            messages: loaded.messages,
            builtin_names: loaded.builtin_names,
            can_load_code_at_run_time: loaded.can_load_code_at_run_time,
            loads_code_by_unknown_names_alone: loaded.loads_code_by_unknown_names_alone,
            finish_asset_reads: loaded.finish_asset_reads,
        };
        let Ok(bound) = self.bind_modules(&world_build) else {
            return;
        };
        let own: Vec<FileId> = (world.files.iter())
            .filter_map(|file| to_world.get(file).copied())
            .collect();
        let left_out = &bound.projects.application.left_out;
        let left_out_bodies = LeftOutBodies::new(left_out.functions.iter().copied())
            .with_files(left_out.files.iter().copied());
        let roles = {
            let request = &CompileRequest {
                left_out_bodies: Some(&left_out_bodies),
                ..request
            };
            decide_roles(&program, application.host, request, &own)
        };
        let files_to_lower: Vec<FileId> = (own.iter().copied())
            .filter(|&file| roles.role(file) == FileRole::Checked && !roles.has_early_error(file))
            .collect();
        let id = ProjectId::Application;
        self.report_check_diagnostics(
            world_build.project(id).view(),
            &roles,
            roles.diagnostics.clone(),
            &roles.incomplete,
        );
        for demotion in &roles.demoted {
            if let Some(file) = to_application[demotion.file.idx()] {
                worlds.demoted.push(Demotion { file, ..*demotion });
            }
        }
        let is_typed =
            |file: &FileId| (world_files.compiled(*file)).is_some_and(|it| it.is_aot_source);
        self.checked_elsewhere = (world_files.compiled_files().iter().copied())
            .filter(|file| is_typed(file) && !own.contains(file))
            .collect();
        self.checked_elsewhere.sort_unstable();
        let threads = self.threads_to_lower(world_files, &files_to_lower);
        let decided = PerProject {
            application: DecidedProject {
                roles,
                files_to_lower,
                left_out_bodies,
            },
            runtime: DecidedProject {
                roles: keep_verified_roles(runtime.loaded, &[]),
                files_to_lower: Vec::new(),
                left_out_bodies: LeftOutBodies::new(core::iter::empty()),
            },
        };
        let rehoming = Rehoming {
            files: &to_application,
            application_graph: bound_application.graph.graph,
            first_fresh_file: files.modules.len() as u32 + ((world.index as u32 + 1) << 20),
            stable_symbol: &|symbol| {
                let whole = world_files.canonical(symbol);
                world_files.parts(whole).first().copied().unwrap_or(whole)
            },
            canonical_symbol: &|symbol| files.canonical(symbol),
        };
        let checked = self.with_inputs_for_reached_code(
            &world_build,
            &bound,
            id,
            &decided.application.roles,
            left_out.functions.clone(),
            |inputs| {
                let mut project =
                    ProjectToLower::new(&world_build, &bound, &decided, id, inputs, threads);
                project.keys.rehoming = Some(&rehoming);
                project.lower()
            },
        );
        let view = world_build.project(id).view();
        for (file, lowered) in checked.lowered {
            let (Some(lowered), Some(file)) = (lowered, to_application[file.idx()]) else {
                if !self.diagnostics.has_errors() {
                    self.diagnostics.add_internal_error(InternalError {
                        stage: Stage::Lower,
                        message: b"a file of a typed package was not lowered by its own program"
                            .to_vec(),
                    });
                }
                continue;
            };
            self.diagnostics.add_buffer(view, lowered.diagnostics);
            self.statistics.add_counters(view, lowered.counters);
            self.statistics.add_queries(lowered.queries);
            worlds.units.push(*lowered.unit);
            worlds.lowered.push(file);
        }
    }

    /// Bun's own modules are lowered beside the application, from one thread of the pool, which the idle ones help.
    fn lower_projects(
        &self,
        loaded: &LoadedBuild<'_, '_>,
        bound: &BoundBuild<'_>,
        decided: &PerProject<DecidedProject>,
        left_out: PerProject<FxHashSet<FunctionRef>>,
    ) -> PerProject<CheckedProgram<Option<LoweredUnit>>> {
        let (application, runtime) = (ProjectId::Application, ProjectId::Runtime);
        let threads_of = |project: ProjectId| {
            let files = loaded.project(project).loaded.files();
            self.threads_to_lower(files, &decided.get(project).files_to_lower)
        };
        let (threads, runtime_threads) = (threads_of(application), threads_of(runtime));
        let has_one_thread = self.threads == NonZeroUsize::MIN;
        self.with_inputs_for_reached_code(
            loaded,
            bound,
            application,
            &decided.application.roles,
            left_out.application,
            |inputs| {
                let mut of_application =
                    ProjectToLower::new(loaded, bound, decided, application, inputs, threads);
                let words = &self.options.aot.option_words;
                of_application.panics =
                    (words.iter()).any(|it| **it == *b"sabotage=LoweringPanics");
                self.with_inputs_for_reached_code(
                    loaded,
                    bound,
                    runtime,
                    &decided.runtime.roles,
                    left_out.runtime,
                    |inputs| {
                        let of_runtime = ProjectToLower::new(
                            loaded,
                            bound,
                            decided,
                            runtime,
                            inputs,
                            runtime_threads,
                        );
                        if has_one_thread {
                            return PerProject {
                                application: of_application.lower(),
                                runtime: of_runtime.lower(),
                            };
                        }
                        let (runtime, application) = run_on_one_thread_while(
                            self.caches,
                            || of_runtime.lower(),
                            || of_application.lower(),
                        );
                        PerProject {
                            application,
                            runtime,
                        }
                    },
                )
            },
        )
    }

    fn report_project(
        &mut self,
        loaded: &LoadedBuild<'_, '_>,
        project: ProjectId,
        decided: &PerProject<DecidedProject>,
        checked: CheckedProgram<Option<LoweredUnit>>,
        units: &mut Vec<LinkUnit>,
    ) {
        let roles = &decided.get(project).roles;
        let view = loaded.project(project).view();
        self.report_check_diagnostics(view, roles, roles.diagnostics.clone(), &roles.incomplete);
        let in_parallel = self.parallel_runner();
        report::count_files(&mut self.statistics, view, roles, &in_parallel);
        self.report_check_diagnostics(view, roles, checked.diagnostics, &checked.incomplete);
        self.diagnostics.add_load_messages(loaded.messages);

        for (file, lowered) in checked.lowered {
            let Some(lowered) = lowered else {
                if !self.diagnostics.has_errors() {
                    self.diagnostics.add_internal_error(InternalError {
                        stage: Stage::Lower,
                        message: b"a file was not lowered and has no error".to_vec(),
                    });
                }
                continue;
            };
            self.diagnostics.add_buffer(view, lowered.diagnostics);
            self.statistics.add_counters(view, lowered.counters);
            self.statistics.add_queries(lowered.queries);
            if project == ProjectId::Runtime && lowered.queries.closed_cycles != 0 {
                self.circular_runtime_files
                    .push((file, lowered.queries.closed_cycles));
            }
            units.push(*lowered.unit);
        }
    }

    /// Unless somebody chose a thread count, no more threads than there is source text for: each thread has a checker of its own, which finds out again what the others know.
    fn threads_to_lower(&self, files: &Files<'_>, files_to_lower: &[FileId]) -> NonZeroUsize {
        const SOURCE_BYTES_PER_THREAD: usize = 256 << 10;
        const MOST_USEFUL_THREADS: usize = 16;
        let texts = files_to_lower.iter();
        let source_bytes: usize = texts.map(|&file| files.module(file).hir.text.len()).sum();
        let useful = source_bytes
            .div_ceil(SOURCE_BYTES_PER_THREAD)
            .min(MOST_USEFUL_THREADS);
        let useful = NonZeroUsize::new(useful).unwrap_or(NonZeroUsize::MIN);
        match self.options.aot.thread_count {
            Some(_) => self.threads,
            None => self.threads.min(useful),
        }
    }

    fn report_check_diagnostics(
        &mut self,
        view: ProgramView<'_, '_>,
        roles: &RoleDecision,
        diagnostics: Vec<BuildDiagnostic>,
        incomplete: &[Incomplete],
    ) {
        let errors = report_package_errors(&mut self.diagnostics, view, diagnostics, roles);
        self.has_withdrawn_trust |= errors.has_withdrawn_trust;
        self.diagnostics
            .add_build_diagnostics(Stage::Check, errors.remaining);
        self.diagnostics.add_incomplete_files(incomplete);
    }

    pub(crate) fn lowering_options(&self) -> LoweringOptions {
        LoweringOptions {
            platform: self.platform,
            embeds_function_text: self.options.aot.embeds_function_source,
            reports_type_mismatches: self.options.aot.reports_type_mismatches,
            removable: self.options.removable,
            minifies_identifiers: self.options.minifies_identifiers,
        }
    }

    pub(crate) fn with_lowering_inputs<R>(
        &self,
        loaded: &LoadedBuild<'_, '_>,
        bound: &BoundBuild<'_>,
        project: ProjectId,
        roles: &RoleDecision,
        then: impl FnOnce(&LoweringInputs<'_>) -> R,
    ) -> R {
        let left_out = FxHashSet::default();
        self.with_inputs_for_reached_code(loaded, bound, project, roles, left_out, then)
    }

    fn with_inputs_for_reached_code<R>(
        &self,
        loaded: &LoadedBuild<'_, '_>,
        bound: &BoundBuild<'_>,
        project: ProjectId,
        roles: &RoleDecision,
        left_out_functions: FxHashSet<FunctionRef>,
        then: impl FnOnce(&LoweringInputs<'_>) -> R,
    ) -> R {
        let loaded_project = loaded.project(project);
        let bound_project = bound.projects.get(project);
        let (files, sources) = (loaded_project.loaded.files(), &loaded_project.sources);
        let mut file_inputs = collect_file_inputs(files, sources);
        for demotion in &roles.demoted {
            if roles.has_early_error(demotion.file) {
                file_inputs[demotion.file.idx()] = None;
            }
        }
        let mut library_functions = LibraryFunctions::compute(files, &file_inputs, sources);
        library_functions.leave_out(left_out_functions);
        library_functions.leave_out_declarations(bound_project.left_out.declarations.clone());
        let defined_object_types = DefinedObjectTypes::default();
        let lowering_roles = roles_for_lowering(&roles.roles, files, self.options.aot.erases_types);
        let library = Library {
            project: LinkedProject {
                files: loaded.project(ProjectId::Runtime).loaded.files(),
                graph: &bound.projects.runtime.graph,
                builtin_names: loaded.builtin_names,
                platform: self.platform,
                library: None,
            },
            sources: &loaded.project(ProjectId::Runtime).sources,
        };
        let linked_project = LinkedProject {
            files,
            graph: &bound_project.graph,
            builtin_names: loaded.builtin_names,
            platform: self.platform,
            library: match project {
                ProjectId::Application => Some(&library),
                ProjectId::Runtime => None,
            },
        };
        let unreached_files: &[FileId] = match project {
            ProjectId::Application => &[],
            ProjectId::Runtime => &self.unreached_runtime_files,
        };
        let is_in_dependency = |file: &FileId| {
            matches!(
                loaded_project.loaded.origin(*file),
                FileOrigin::DependencySource | FileOrigin::DependencyJavaScript
            )
        };
        let compiled = files.compiled_files().iter().copied();
        let mut files_of_dependencies: Vec<FileId> = compiled.filter(is_in_dependency).collect();
        files_of_dependencies.sort_unstable();
        then(&LoweringInputs {
            roles: &lowering_roles,
            checked_elsewhere: match project {
                ProjectId::Application => &self.checked_elsewhere,
                ProjectId::Runtime => &[],
            },
            builtin_types: &bound_project.builtin_types,
            named_values: &linked_project,
            builtin_names: loaded.builtin_names,
            sources,
            modules: &bound_project.graph,
            unreached_files,
            files_of_dependencies: &files_of_dependencies,
            deferred_data: &bound_project.deferred_data,
            library_functions: &library_functions,
            known_helpers: &bound_project.known_helpers,
            commonjs_exports: bound_project.graph.commonjs(),
            defined_object_types: &defined_object_types,
            files: &file_inputs,
            limits: &self.limits,
            options: self.lowering_options(),
        })
    }
}

pub(crate) fn find_files_to_lower(compiled_files: &[FileId], roles: &RoleDecision) -> Vec<FileId> {
    let files = compiled_files.iter().copied();
    files.filter(|&file| !roles.has_early_error(file)).collect()
}

pub(crate) fn collect_file_inputs<'s>(
    files: &Files<'s>,
    sources: &Sources,
) -> Vec<Option<FileInputs<'s>>> {
    let mut inputs = vec![None; files.modules.len()];
    for &file in files.compiled_files() {
        let source = sources.kind(file).lowering_kind();
        let parsed = parsed_source(files, file);
        inputs[file.idx()] = Some(FileInputs {
            source: source.expect("a compiled file is lowered"),
            builtins: &parsed.expect("freeze checked every payload").builtins,
        });
    }
    inputs
}

fn roles_for_lowering<'r>(
    roles: &'r [FileRole],
    files: &Files<'_>,
    erases_types: bool,
) -> Cow<'r, [FileRole]> {
    let mut erased_roles = Cow::Borrowed(roles);
    if !erases_types {
        return erased_roles;
    }
    for &file in files.compiled_files() {
        if roles[file.idx()] == FileRole::Checked {
            erased_roles.to_mut()[file.idx()] = FileRole::Inferred;
        }
    }
    erased_roles
}

// The tree of a text that does not parse has holes that no rule of the language allows, and a class declaration without a name has a symbol that is in no scope.
fn drop_reports_on_unloadable_modules(
    files: &Files<'_>,
    graph: &ModuleGraph,
    checked: &mut CheckedProgram<Option<LoweredUnit>>,
) {
    let is_lowered = |file: &FileId| {
        let mut lowered = checked.lowered.iter();
        lowered.any(|(lowered, unit)| lowered == file && unit.is_some())
    };
    let lowered = graph.unloadable_files().filter(is_lowered);
    let paths: FxHashSet<&[u8]> = lowered.map(|file| files.module(file).file_name()).collect();
    if !paths.is_empty() {
        checked
            .diagnostics
            .retain(|reported| !paths.contains(&reported.diagnostic.path[..]));
    }
}

fn is_well_formed(files: &Files<'_>, file: FileId) -> bool {
    let module = files.module(file);
    let mut diagnostics = module.hir.diagnostics.iter();
    let mut classes = module.bound.class_symbol.iter();
    !diagnostics
        .any(|it| it.kind == DiagnosticKind::Parse && it.class == DiagnosticClass::EarlyError)
        && !classes.any(|&it| it.is_some() && module.bound.symbol(it).name == known::missing)
}

fn finish_lowered_file(
    keys: &KeyContext<'_>,
    library_functions: &LibraryFunctions,
    lowered: LoweredFile,
) -> LoweredUnit {
    let LoweredFile {
        fragment,
        diagnostics,
        mut counters,
        queries,
    } = lowered;
    let functions = fragment.functions.iter();
    let is_left_out = |function: FunctionId| match fragment.function_keys[function.index()] {
        FunctionKey::Source(source) => library_functions.is_left_out(source),
        _ => false,
    };
    let function_count = functions
        .filter(|(id, function)| function.role != FunctionRole::Signature && !is_left_out(*id))
        .count() as u64;
    counters.count(StatisticId::FunctionsLowered, function_count);
    LoweredUnit {
        unit: Box::new(LinkUnit::new(keys, fragment)),
        diagnostics,
        counters,
        queries,
    }
}
