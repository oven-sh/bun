use super::runtime_reach::{
    Application, KeptCodeInput, LoadedLibrary, ReachInput, ReachedRuntimeCode,
    find_reached_runtime_code, find_uses_of_kept_code,
};
use super::{BoundBuild, Build, LoadedBuild, LoadedProject};
use crate::diagnostic_codes::Code;
use crate::diagnostics::{
    DiagnosticBuffer, Diagnostics, InternalError, describe_first_fold_error, syntax_errors_of,
};
use crate::ir::extend_from_boxes;
use crate::ir::generated::FunctionRole;
use crate::link::{KeyContext, LinkUnit};
use crate::load::data_modules::parse_json;
use crate::load::runtime_roots::builtins_used_at_start;
use crate::load::runtime_types;
use crate::load::sources::parsed_source;
use crate::load::{PerProject, ProjectId, Sources};
use crate::lower::{
    FileInputs, KnownHelpersLowered, LibraryFunctions, LoweredFile, LoweringInputs,
    LoweringOptions, NamesCreatedOnExports, SaidTypes, lower_file, lower_file_that_throws,
};
use crate::modules::{Library, LinkedProject, ModuleGraph, ModuleKind};
use crate::report;
use crate::statistics::{Stage, StatisticId, instructions_of_all_threads, logs_stages};
use bun_ast::runtime::ReactCompilerMode;
use bun_core::current_work;
use bun_options_types::aot_options::DependencyTypeErrors;
use bun_sema::atom::known;
use bun_sema::bind::{Binding, CommonJsVariable};
use bun_sema::check::Checker;
use bun_sema::check::aot::{
    DiagnosticClass, Effect, FileOrigin, FunctionRef, LeftOutBodies, QueryStatistics,
};
use bun_sema::hir_from_data::DataValue;
use bun_sema::import_sites::ImportSiteKind;
use bun_sema::messages;
use bun_sema::program::{FileId, FileRole, Files};
use bun_sema::resolve::AOT_CONDITION;
use bun_sema_driver::{
    self as driver, BuildDiagnostic, CheckedProgram, CompileRequest, Incomplete, RoleDecision,
    TextLocator, decide_roles, keep_verified_roles, run_on_one_thread_while,
};
use bun_threading::Guarded;
use rustc_hash::{FxHashMap, FxHashSet};
use std::borrow::Cow;
use std::num::NonZeroUsize;
use std::sync::atomic::{AtomicU64, Ordering};

pub(crate) struct LoweredUnit {
    pub unit: Box<LinkUnit>,
    pub diagnostics: DiagnosticBuffer,
    pub queries: QueryStatistics,
    pub functions_lowered: u64,
    pub values_lowered: u64,
    pub known_helpers: KnownHelpersLowered,
    pub function_sources_reparsed: u64,
    pub written_function_names: Vec<u8>,
    pub throws_at_load: bool,
}

struct ViewsOfProject<'a> {
    read_texts_of_build: &'a dyn Fn() -> driver::host::AlreadyRead,
    is_own_module: &'a dyn Fn(FileId) -> bool,
    list_own_modules: &'a dyn Fn() -> FxHashMap<Vec<u8>, FileId>,
    is_checked_by_build: &'a dyn Fn(FileId, u32) -> bool,
}

struct DecidedProject {
    roles: RoleDecision,
    files_to_lower: Vec<FileId>,
    left_out_bodies: LeftOutBodies,
    unchecked_ranges: Option<Guarded<Vec<(FileId, u32, u32)>>>,
    first_reported_early_errors: Vec<(FileId, u32)>,
    files_nested_too_deeply: Vec<FileId>,
}

impl DecidedProject {
    fn first_reported_early_error(&self, file: FileId) -> Option<&driver::Diagnostic> {
        let first = &self.first_reported_early_errors;
        let at = first.binary_search_by_key(&file, |entry| entry.0).ok()?;
        Some(&self.roles.diagnostics[first[at].1 as usize].diagnostic)
    }
}

struct LoweredApplication {
    decided: PerProject<DecidedProject>,
    checked: PerProject<CheckedProgram<Option<LoweredUnit>>>,
}

struct ProjectToLower<'a, 'b, 's> {
    loaded: &'a LoadedProject<'b, 's>,
    decided: &'a DecidedProject,
    keys: KeyContext<'a>,
    inputs: &'a LoweringInputs<'a>,
    threads: NonZeroUsize,
    counts_instructions: bool,
    instructions_of_lowering: AtomicU64,
}

impl<'a, 'b, 's> ProjectToLower<'a, 'b, 's> {
    fn new(
        loaded: &'a LoadedBuild<'b, 's>,
        bound: &'a BoundBuild,
        decided: &'a PerProject<DecidedProject>,
        project: ProjectId,
        inputs: &'a LoweringInputs<'a>,
        threads: NonZeroUsize,
        counts_instructions: bool,
    ) -> ProjectToLower<'a, 'b, 's> {
        ProjectToLower {
            loaded: loaded.project(project),
            decided: decided.get(project),
            keys: KeyContext {
                project,
                graph: &bound.projects.get(project).graph,
                runtime_sources: &loaded.project(ProjectId::Runtime).sources,
            },
            inputs,
            threads,
            counts_instructions,
            instructions_of_lowering: AtomicU64::new(0),
        }
    }

    fn instructions_of_lowering(&self) -> u64 {
        self.instructions_of_lowering.load(Ordering::Relaxed)
    }

    fn count_instructions<R>(&self, lower: impl FnOnce() -> R) -> R {
        if !self.counts_instructions {
            return lower();
        }
        let before = instructions_of_all_threads();
        let lowered = lower();
        if let (Some(before), Some(after)) = (before, instructions_of_all_threads()) {
            let total = &self.instructions_of_lowering;
            total.fetch_add(after.saturating_sub(before), Ordering::Relaxed);
        }
        lowered
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
            &|checker, file| self.lower_checked_file(checker, file),
            &|_, lowered: &Option<LoweredUnit>| {
                if let Some(lowered) = lowered {
                    lowered.unit.note_commit(self.inputs.said_types);
                }
            },
            &driver::Passes {
                count: driver::PassCount::Exactly(1),
                before_next: &|| {},
            },
        )
    }

    fn lower_checked_file(
        &self,
        checker: &mut Checker<'_, 's>,
        file: FileId,
    ) -> Option<Option<LoweredUnit>> {
        if let Some(ranges) = &self.decided.unchecked_ranges
            && self.loaded.loaded.origin(file) == FileOrigin::ProgramSource
        {
            let unchecked = checker.never_checked_ranges().iter();
            let unchecked = unchecked.map(|&(start, end)| (file, start, end));
            ranges.lock().extend(unchecked);
        }
        let path = self.loaded.loaded.files().module(file).file_name();
        let _work = current_work::working_on(current_work::Step::Lower, path);
        let may_fail_where_loaded = self.may_fail_where_loaded(file);
        let is_refused = self.cannot_be_lowered(checker, file)
            || may_fail_where_loaded
                && (self.is_nested_too_deeply_to_check(checker, file)
                    || self.is_commonjs_file_that_folding_refuses(file));
        if is_refused {
            let sentence = match may_fail_where_loaded {
                true => self.describe_first_error(checker, file),
                false => None,
            };
            let Some(sentence) = sentence else {
                return Some(None);
            };
            let lower = || self.lower_module_that_throws(checker, file, &sentence);
            return self.count_instructions(lower);
        }
        self.count_instructions(|| {
            let mut lowered = lower_file(self.inputs, checker, file)?;
            let view = self.loaded.view();
            if may_fail_where_loaded
                && let Some(sentence) = lowered.diagnostics.take_errors_found_at_load(view)
            {
                drop(lowered);
                return self.lower_module_that_throws(checker, file, &sentence);
            }
            Some(Some(finish_lowered_file(&self.keys, lowered)))
        })
    }

    fn lower_module_that_throws(
        &self,
        checker: &mut Checker<'_, 's>,
        file: FileId,
        sentence: &[u8],
    ) -> Option<Option<LoweredUnit>> {
        let lowered = lower_file_that_throws(self.inputs, checker, file, sentence)?;
        Some(Some(LoweredUnit {
            diagnostics: DiagnosticBuffer::default(),
            throws_at_load: true,
            ..finish_lowered_file(&self.keys, lowered)
        }))
    }

    fn may_fail_where_loaded(&self, file: FileId) -> bool {
        let runs_tests = self.inputs.options.runs_tests;
        may_fail_where_loaded(self.keys.project, runs_tests, self.keys.graph, file)
            || self.loaded.view().origin(file) == FileOrigin::EvaluatedText
    }

    fn cannot_be_lowered(&self, checker: &Checker<'_, '_>, file: FileId) -> bool {
        !is_well_formed(self.loaded.loaded.files(), file)
            || checker.found_early_error(file)
            || self.decided.first_reported_early_error(file).is_some()
            || self.decided.roles.has_early_error(file)
    }

    fn is_nested_too_deeply_to_check(&self, checker: &Checker<'_, '_>, file: FileId) -> bool {
        let files = self.loaded.loaded.files();
        let nested_too_deeply = &self.decided.files_nested_too_deeply;
        nested_too_deeply.binary_search(&file).is_ok()
            || checker.ran_out_of_stack()
                && !is_fault_of_compiler(&incomplete_record_of(files, file))
    }

    fn is_commonjs_file_that_folding_refuses(&self, file: FileId) -> bool {
        self.keys.graph.kind(file) == ModuleKind::CommonJs
            && !self.loaded.loaded.files().analysis(file).errors.is_empty()
    }

    fn describe_first_error(&self, checker: &Checker<'_, '_>, file: FileId) -> Option<Vec<u8>> {
        let files = self.loaded.loaded.files();
        let hir = files.hir(file);
        if hir.ran_out_of_stack || self.is_nested_too_deeply_to_check(checker, file) {
            let path = self.loaded.sources.public_path(file);
            return Some(Code::FileNestedTooDeeply.message(&[path]));
        }
        let at_offset = |sentence: Vec<u8>, offset: u32| {
            let locator = TextLocator::new(files.module(file).file_name(), &hir.text[..]);
            with_position(sentence, locator.line_and_column(offset))
        };
        let is_no_javascript =
            |it: &&bun_sema::hir::Diagnostic| it.kind == bun_sema::hir::DiagnosticKind::Js;
        let of_parser = syntax_errors_of(hir).next();
        if let Some(first) = of_parser.or_else(|| hir.diagnostics.iter().find(is_no_javascript)) {
            let (_, template) = messages::message(first.code)?;
            let mut sentence = Vec::new();
            messages::format(&mut sentence, template, &first.args);
            return Some(at_offset(sentence, first.start));
        }
        if let Some((sentence, start)) = checker.first_early_error(file) {
            return Some(at_offset(sentence.to_vec(), start));
        }
        if let Some(first) = self.decided.first_reported_early_error(file) {
            let sentence = bun_core::strings::split(&first.text, b"\n").next()?;
            return Some(with_position(sentence.to_vec(), (first.line, first.column)));
        }
        describe_first_fold_error(self.loaded.view(), file)
    }
}

impl Build<'_> {
    pub(crate) fn check_and_lower(
        &mut self,
        loaded: &LoadedBuild<'_, '_>,
        bound: &BoundBuild,
    ) -> Vec<LinkUnit> {
        self.clock.start(Stage::Check);
        let reached = self.find_reached_library_code(loaded, bound);
        let lowered = self.lower_application(loaded, bound, &reached);
        let in_parallel = self.parallel_runner();
        for project in [ProjectId::Application, ProjectId::Runtime] {
            // SAFETY: both projects are lowered, and what follows reads names and text alone.
            unsafe { loaded.project(project).loaded.free_trees(&in_parallel) };
            // SAFETY: as above, and what is lowered owns its data.
            unsafe { loaded.project(project).loaded.free_checker(&in_parallel) };
        }
        let LoweredApplication {
            mut decided,
            mut checked,
        } = lowered;
        let files = loaded.project(ProjectId::Application).loaded.files();
        drop_reports_on_unloadable_modules(
            files,
            &bound.projects.application.graph,
            &mut checked.application,
        );
        drop_errors_of_modules_that_throw(
            files,
            &mut decided.application.roles,
            &mut checked.application,
        );
        let unit_count = checked.application.lowered.len() + checked.runtime.lowered.len();
        let mut units = Vec::with_capacity(unit_count);
        checked.map(|project, checked| {
            self.report_project(loaded, project, &decided, checked, &mut units);
        });
        units
    }

    fn lower_application(
        &mut self,
        loaded: &LoadedBuild<'_, '_>,
        bound: &BoundBuild,
        reached: &ReachedRuntimeCode,
    ) -> LoweredApplication {
        self.clock.start(Stage::Check);
        let runs_tests = self.options.load.runs_tests;
        let mut decided = loaded.projects.as_ref().map(|id, project| {
            let all_compiled_files = project.loaded.files().compiled_files();
            let left_out = &bound.projects.get(id).left_out;
            let left_out_bodies = LeftOutBodies::new(left_out.functions.iter().copied())
                .with_files(left_out.files.iter().copied());
            let roles = match id {
                ProjectId::Application => {
                    let graph = &bound.projects.get(id).graph;
                    let files = all_compiled_files.iter().copied();
                    let of_loader = files.filter(|&it| graph.is_found_by_computed_names_alone(it));
                    project.loaded.leave_files_to_loader(of_loader.collect());
                    let request = &CompileRequest {
                        left_out_bodies: Some(&left_out_bodies),
                        ..*project.request
                    };
                    decide_roles(project.loaded, project.host, request, all_compiled_files)
                }
                ProjectId::Runtime => keep_verified_roles(project.loaded, all_compiled_files),
            };
            let graph = &bound.projects.get(id).graph;
            let mut files_to_lower = find_files_to_lower(all_compiled_files, &roles, |file| {
                may_fail_where_loaded(id, runs_tests, graph, file)
                    || project.loaded.origin(file) == FileOrigin::EvaluatedText
            });
            files_to_lower.retain(|&file| {
                left_out.files.binary_search(&file).is_err() || graph.is_placeholder(file)
            });
            let files = project.loaded.files();
            let keeps_unchecked_ranges =
                id == ProjectId::Application && files.brings_declarations();
            DecidedProject {
                unchecked_ranges: keeps_unchecked_ranges.then(|| Guarded::new(Vec::new())),
                first_reported_early_errors: find_first_reported_early_errors(&roles),
                files_nested_too_deeply: find_files_nested_too_deeply(
                    project.loaded.files(),
                    &roles,
                ),
                roles,
                files_to_lower,
                left_out_bodies,
            }
        });
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
            runtime: reached.left_out_functions.clone(),
        };
        let checked = self.lower_projects(loaded, bound, &decided, left_out);
        LoweredApplication { decided, checked }
    }

    fn find_reached_library_code(
        &self,
        loaded: &LoadedBuild<'_, '_>,
        bound: &BoundBuild,
    ) -> ReachedRuntimeCode {
        let library = LoadedLibrary {
            files: loaded.project(ProjectId::Runtime).loaded.files(),
            sources: &loaded.project(ProjectId::Runtime).sources,
            graph: &bound.projects.runtime.graph,
        };
        let used_at_start = builtins_used_at_start(self.options.aot);
        let rewrites_no_text = self.options.load.react_compiler == ReactCompilerMode::Disabled;
        let uses_of_kept_code = match loaded.holds_it_for_uses_of_files_alone && rewrites_no_text {
            true => find_uses_of_kept_code(&KeptCodeInput {
                application: loaded.project(ProjectId::Application).loaded.files(),
                graph: &bound.projects.application.graph,
                left_out_functions: &bound.projects.application.left_out.functions,
                left_out_declarations: &bound.projects.application.left_out.declarations,
                names: loaded.builtin_names,
                platform: self.platform,
                replaced: &loaded.contents.replaced_builtins,
                runs_tests: self.options.load.runs_tests,
            }),
            false => None,
        };
        let reach_input = ReachInput {
            application: Application::Bound {
                files: loaded.project(ProjectId::Application).loaded.files(),
                graph: &bound.projects.application.graph,
            },
            library: &library,
            names: loaded.builtin_names,
            platform: self.platform,
            used_at_start: &used_at_start,
            holds_what_unseen_code_finds: loaded.holds_what_unseen_code_finds
                && uses_of_kept_code.is_none(),
            uses_of_kept_code: uses_of_kept_code.as_ref(),
            can_load_code_at_run_time: loaded.can_load_code_at_run_time
                && !(loaded.loads_code_by_unknown_names_alone
                    && bound
                        .projects
                        .application
                        .left_out
                        .holds_every_load_by_unknown_name),
        };
        let known = (loaded.known_library_regions)();
        find_reached_runtime_code(&reach_input, known, &self.parallel_runner())
    }

    fn lower_projects(
        &self,
        loaded: &LoadedBuild<'_, '_>,
        bound: &BoundBuild,
        decided: &PerProject<DecidedProject>,
        left_out: PerProject<FxHashSet<FunctionRef>>,
    ) -> PerProject<CheckedProgram<Option<LoweredUnit>>> {
        let library = loaded.project(ProjectId::Runtime).loaded.files();
        library.let_no_more_trees_go();
        let (application, runtime) = (ProjectId::Application, ProjectId::Runtime);
        let threads_of = |project: ProjectId| {
            let files = loaded.project(project).loaded.files();
            self.threads_to_lower(files, &decided.get(project).files_to_lower)
        };
        let (threads, runtime_threads) = (threads_of(application), threads_of(runtime));
        let has_one_thread = self.threads == NonZeroUsize::MIN;
        let counts_instructions = has_one_thread && logs_stages();
        self.with_inputs_for_reached_code(
            loaded,
            bound,
            application,
            &decided.application.roles,
            left_out.application,
            |inputs| {
                let of_application = ProjectToLower::new(
                    loaded,
                    bound,
                    decided,
                    application,
                    inputs,
                    threads,
                    counts_instructions,
                );
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
                            counts_instructions,
                        );
                        let (runtime, application) = match has_one_thread {
                            true => {
                                let application = of_application.lower();
                                (of_runtime.lower(), application)
                            }
                            false => run_on_one_thread_while(
                                self.caches,
                                || of_runtime.lower(),
                                || of_application.lower(),
                            ),
                        };
                        if counts_instructions && instructions_of_all_threads().is_some() {
                            bun_core::print_errorln!(
                                "AOT instructions: lowering | {}",
                                of_application.instructions_of_lowering()
                                    + of_runtime.instructions_of_lowering(),
                            );
                        }
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
        self.report_check_diagnostics(roles.diagnostics.clone(), &roles.incomplete);
        let in_parallel = self.parallel_runner();
        report::count_files(&mut self.statistics, view, roles, &in_parallel);
        if self.options.aot.dependency_type_errors != DependencyTypeErrors::NotChecked {
            let program = loaded.project(project).loaded;
            let compiled_files = program.files().compiled_files().iter();
            let unchecked = compiled_files.filter(|&&file| {
                program.origin(file) == FileOrigin::DependencySource
                    && roles.role(file) == FileRole::Checked
                    && !program.files().is_checked_as_by_own_project(file)
            });
            let id = StatisticId::DependencyFilesNotVerified;
            self.statistics.count(id, unchecked.count() as u64);
        }
        let mut found = checked.diagnostics;
        let files = loaded.project(project).loaded.files();
        let brings_declarations = files.brings_declarations();
        let host = loaded.project(project).host;
        let held_in_memory = &self.options.load.in_memory_files;
        let read_texts_of_build = || {
            let held = held_in_memory.iter();
            let held = held.map(|(path, text)| (driver::host::from_native(path), text.clone()));
            let given = files.compiled_files().iter().filter_map(|&file| {
                let path = files.module(file).file_name();
                let is_file_on_disk =
                    parsed_source(files, file).is_some_and(|it| it.plugin_module.is_none());
                (is_file_on_disk && host.is_plugin_source(path))
                    .then(|| (path.to_vec(), host.read_source(path).into_owned()))
            });
            held.chain(given).collect()
        };
        let DecidedProject {
            left_out_bodies,
            unchecked_ranges,
            ..
        } = decided.get(project);
        let unchecked_ranges = match unchecked_ranges {
            Some(ranges) => std::mem::take(&mut *ranges.lock()),
            None => Vec::new(),
        };
        let program = loaded.project(project).loaded;
        let is_own_module = |file: FileId| {
            brings_declarations
                && program.origin(file) == FileOrigin::ProgramSource
                && roles.role(file) == FileRole::Checked
                && !files.hir(file).is_script_for_project
                && !left_out_bodies.contains_file(file)
                && parsed_source(files, file).is_some_and(|it| it.plugin_module.is_none())
        };
        let list_own_modules = || {
            let own = files.compiled_files().iter();
            let own = own.filter(|&&file| is_own_module(file));
            own.map(|&file| (files.module(file).file_name().to_vec(), file))
                .collect()
        };
        let is_checked_by_build = |file: FileId, position: u32| {
            let mut ranges = unchecked_ranges.iter();
            !ranges.any(|&(of, start, end)| of == file && (start..end).contains(&position))
        };
        let views = ViewsOfProject {
            read_texts_of_build: &read_texts_of_build,
            is_own_module: &is_own_module,
            list_own_modules: &list_own_modules,
            is_checked_by_build: &is_checked_by_build,
        };
        self.keep_what_project_itself_reports(&mut found, &views, |it| {
            let file = it.diagnostic.file;
            brings_declarations || file.is_some_and(|file| files.hir(file).is_script_for_project)
        });
        self.report_check_diagnostics(found, &checked.incomplete);
        self.diagnostics.add_load_messages(loaded.messages);

        let mut lowered_units = Vec::with_capacity(checked.lowered.len());
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
            if project == ProjectId::Runtime && lowered.queries.closed_cycles != 0 {
                self.circular_runtime_files
                    .push((file, lowered.queries.closed_cycles));
            }
            let statistics = &mut self.statistics;
            statistics.count(StatisticId::FunctionsLowered, lowered.functions_lowered);
            statistics.count(StatisticId::ValuesLowered, lowered.values_lowered);
            let known_helpers = lowered.known_helpers;
            statistics.count(StatisticId::KnownHelperFunctions, known_helpers.functions);
            statistics.count(StatisticId::KnownHelperCalls, known_helpers.calls);
            statistics.count(
                StatisticId::FunctionSourcesReparsed,
                lowered.function_sources_reparsed,
            );
            self.written_function_names
                .extend_from_slice(&lowered.written_function_names);
            lowered_units.push(lowered.unit);
        }
        extend_from_boxes(units, lowered_units, &in_parallel);
    }

    fn threads_to_lower(&self, files: &Files<'_>, files_to_lower: &[FileId]) -> NonZeroUsize {
        const SOURCE_BYTES_PER_THREAD: usize = 256 << 10;
        let texts = files_to_lower.iter();
        let source_bytes: usize = texts.map(|&file| files.module(file).hir.text.len()).sum();
        let useful = source_bytes.div_ceil(SOURCE_BYTES_PER_THREAD);
        let useful = NonZeroUsize::new(useful).unwrap_or(NonZeroUsize::MIN);
        match self.options.aot.thread_count {
            Some(_) => self.threads,
            None => self.threads.min(useful),
        }
    }

    fn keep_what_project_itself_reports(
        &self,
        diagnostics: &mut Vec<BuildDiagnostic>,
        views: &ViewsOfProject<'_>,
        is_seen_otherwise_by_project: impl Fn(&BuildDiagnostic) -> bool,
    ) {
        let read_texts_of_build = views.read_texts_of_build;
        let is_asked = |it: &BuildDiagnostic| {
            matches!(
                it.diagnostic.class,
                DiagnosticClass::Semantic
                    | DiagnosticClass::MissingDeclaration
                    | DiagnosticClass::Style
            ) && matches!(it.effect, Effect::StopsBuild | Effect::Warns)
                && !it.diagnostic.path.is_empty()
                && is_seen_otherwise_by_project(it)
        };
        let asked = diagnostics.iter().filter(|it| is_asked(it));
        let mut paths: Vec<Vec<u8>> = asked.map(|it| it.diagnostic.path.clone()).collect();
        if paths.is_empty() {
            return;
        }
        paths.sort();
        paths.dedup();
        let has_no_extension = |path: &&Vec<u8>| bun_paths::extension(path).is_empty();
        let script_kinds: Vec<(Vec<u8>, driver::ScriptKind)> = (paths.iter())
            .filter(has_no_extension)
            .map(|path| (path.clone(), driver::ScriptKind::Ts))
            .collect();
        let conditions = self.options.code.custom_conditions.iter();
        let conditions = conditions.filter(|it| it[..] != *AOT_CONDITION);
        let conditions: Vec<Box<[u8]>> = conditions.map(|it| it[..].into()).collect();
        let request = driver::Request {
            cwd: &self.options.code.working_directory,
            project: self.options.code.tsconfig_override.as_deref(),
            listed_projects: None,
            build: false,
            errors: &[],
            paths: &paths,
            are_entry_points: false,
            script_kinds: &script_kinds,
            script_kinds_by_extension: &[],
            conditions: &conditions,
            compiler_options: &[],
            threads: self.threads.get(),
            libs: self.options.typescript_libs,
            progress: None,
            order: 1,
            plan_options: driver::PlanOptions {
                checks_only_requested_paths: true,
                takes_defaults_of_tsc: true,
                ..Default::default()
            },
            stops_like_tsc: false,
            uses_typescript_wording: false,
            after_file: None,
        };
        let place_of = |it: &driver::Diagnostic| {
            let is_about_name = driver::says_that_name_is_not_found(it.code);
            let is_style = it.class == DiagnosticClass::Style;
            (it.path.clone(), it.start, is_about_name, is_style)
        };
        let needs_extension = |it: &&driver::Diagnostic| matches!(it.code, 2834 | 2835);
        let can_be_mistake = |it: &&driver::Diagnostic| {
            it.class == DiagnosticClass::Semantic && matches!(place_of(it), (.., false, false))
        };
        type Places = FxHashSet<(Vec<u8>, u32, bool, bool)>;
        let mut spans: FxHashMap<Vec<u8>, Vec<(u32, u32)>> = FxHashMap::default();
        let mut reported_by_project: Vec<driver::Diagnostic> = Vec::new();
        let provided = driver::host::Provided {
            already_read: read_texts_of_build(),
            ..Default::default()
        };
        let (reported, unasked): (Places, FxHashSet<Vec<u8>>) =
            driver::check_provided_then(&request, provided, |report| {
                let reported = report.diagnostics.iter();
                let errors = reported.filter(|it| it.category == driver::Category::Error);
                for it in errors.clone() {
                    if let (path, _, false, false) = place_of(it) {
                        spans.entry(path).or_default().push((it.start, it.end));
                    }
                }
                reported_by_project.extend(errors.clone().filter(can_be_mistake).cloned());
                let unasked = errors.clone().filter(needs_extension).map(|it| &it.path);
                let not_found = (report.files_checked < paths.len()).then_some(&paths);
                let unasked = unasked
                    .chain(not_found.into_iter().flatten())
                    .cloned()
                    .collect();
                (errors.map(place_of).collect(), unasked)
            });
        for spans in spans.values_mut() {
            spans.sort_unstable();
            let mut furthest = 0;
            for (_, end) in spans {
                furthest = furthest.max(*end);
                *end = furthest;
            }
        }
        let is_held = |found: &driver::Diagnostic| {
            let Some(spans) = spans.get(&found.path) else {
                return false;
            };
            let until = spans.partition_point(|&(start, _)| start <= found.start);
            until > 0 && found.end <= spans[until - 1].1
        };
        let mut has_dropped_error = false;
        diagnostics.retain(|it| {
            let found = &it.diagnostic;
            let is_kept = !is_asked(it)
                || unasked.contains(&found.path)
                || reported.contains(&place_of(found))
                || place_of(found).2 && is_held(found);
            has_dropped_error |= !is_kept
                && it.effect == Effect::StopsBuild
                && !place_of(found).2
                && found.file.is_some_and(views.is_own_module);
            is_kept
        });
        if !has_dropped_error {
            return;
        }
        let own_modules = (views.list_own_modules)();
        let mut others: Vec<Vec<u8>> = own_modules.keys().cloned().collect();
        others.retain(|path| paths.binary_search(path).is_err());
        others.sort();
        if !others.is_empty() {
            let provided = driver::host::Provided {
                already_read: read_texts_of_build(),
                ..Default::default()
            };
            let request = driver::Request {
                paths: &others,
                ..request
            };
            driver::check_provided_then(&request, provided, |report| {
                let reported = report.diagnostics.iter();
                let errors = reported.filter(|it| it.category == driver::Category::Error);
                reported_by_project.extend(errors.filter(can_be_mistake).cloned());
            });
        }
        let lacks_extension: FxHashSet<Vec<u8>> = (reported_by_project.iter())
            .filter(needs_extension)
            .map(|it| it.path.clone())
            .collect();
        let kept: Places = (diagnostics.iter().map(|it| place_of(&it.diagnostic))).collect();
        reported_by_project.retain(|it| {
            !kept.contains(&place_of(it))
                && !unasked.contains(&it.path)
                && !lacks_extension.contains(&it.path)
                && (own_modules.get(&it.path))
                    .is_some_and(|&file| (views.is_checked_by_build)(file, it.start))
        });
        if reported_by_project.is_empty() {
            return;
        }
        let candidates = reported_by_project.iter().map(|it| it.path.clone());
        let mut candidates: Vec<Vec<u8>> = candidates.collect();
        candidates.sort();
        candidates.dedup();
        let mut already_read = read_texts_of_build();
        already_read.extend(runtime_types::read_all());
        let provided = driver::host::Provided {
            already_read,
            ..Default::default()
        };
        let request = driver::Request {
            paths: &candidates,
            plan_options: driver::PlanOptions {
                type_root_of_last_resort: Some(runtime_types::TYPE_ROOT),
                takes_defaults_of_tsc: false,
                ..request.plan_options
            },
            ..request
        };
        let reported_with_bun_types: Places =
            driver::check_provided_then(&request, provided, |report| {
                let reported = report.diagnostics.iter();
                let errors = reported.filter(|it| it.category == driver::Category::Error);
                errors.map(place_of).collect()
            });
        for found in reported_by_project {
            if reported_with_bun_types.contains(&place_of(&found)) {
                let file = own_modules.get(&found.path).copied();
                diagnostics.push(BuildDiagnostic {
                    diagnostic: driver::Diagnostic { file, ..found },
                    effect: Effect::StopsBuild,
                });
            }
        }
    }

    fn report_check_diagnostics(
        &mut self,
        mut diagnostics: Vec<BuildDiagnostic>,
        incomplete: &[Incomplete],
    ) {
        if self.options.aot.type_errors_warn {
            for reported in &mut diagnostics {
                if reported.effect == Effect::StopsBuild
                    && reported.diagnostic.class != DiagnosticClass::EarlyError
                {
                    reported.effect = Effect::Warns;
                }
            }
        }
        let is_of_dependency =
            |reported: &BuildDiagnostic| reported.effect == Effect::WithdrawsTrust;
        match self.options.aot.dependency_type_errors {
            DependencyTypeErrors::NotChecked => {}
            DependencyTypeErrors::Listed => {
                for reported in diagnostics.iter_mut().filter(|it| is_of_dependency(it)) {
                    reported.effect = Effect::StopsBuild;
                }
            }
            DependencyTypeErrors::Counted => {
                let (of_dependencies, own): (Vec<_>, Vec<_>) =
                    diagnostics.into_iter().partition(is_of_dependency);
                diagnostics = own;
                let file_count = self
                    .diagnostics
                    .add_dependency_type_errors(&of_dependencies);
                let id = StatisticId::DependencyFilesNotVerified;
                self.statistics.count(id, file_count as u64);
            }
        }
        self.diagnostics
            .add_build_diagnostics(Stage::Check, diagnostics);
        self.diagnostics.add_incomplete_files(incomplete);
    }

    pub(crate) fn lowering_options(&self) -> LoweringOptions {
        LoweringOptions {
            platform: self.platform,
            embeds_function_source: self.options.aot.embeds_function_source,
            reparses_function_sources: self.options.reads_back_what_it_writes(),
            removable: self.options.removable,
            minifies_identifiers: self.options.minifies_identifiers,
            obfuscates: self.options.aot.hides_names(),
            counts_executions: self.options.aot.counts_executions,
            runs_tests: self.options.load.runs_tests,
        }
    }

    #[cfg(test)]
    pub(crate) fn with_lowering_inputs<R>(
        &self,
        loaded: &LoadedBuild<'_, '_>,
        bound: &BoundBuild,
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
        bound: &BoundBuild,
        project: ProjectId,
        roles: &RoleDecision,
        left_out_functions: FxHashSet<FunctionRef>,
        then: impl FnOnce(&LoweringInputs<'_>) -> R,
    ) -> R {
        let (mut then, mut result) = (Some(then), None);
        let left_out = left_out_functions;
        self.create_inputs_for_reached_code(
            loaded,
            bound,
            project,
            roles,
            left_out,
            &mut |inputs| {
                let then = then.take().expect("the inputs are created once");
                result = Some(then(inputs));
            },
        );
        result.expect("the inputs are created once")
    }

    fn create_inputs_for_reached_code(
        &self,
        loaded: &LoadedBuild<'_, '_>,
        bound: &BoundBuild,
        project: ProjectId,
        roles: &RoleDecision,
        left_out_functions: FxHashSet<FunctionRef>,
        then: &mut dyn FnMut(&LoweringInputs<'_>),
    ) {
        let loaded_project = loaded.project(project);
        let bound_project = bound.projects.get(project);
        let (files, sources) = (loaded_project.loaded.files(), &loaded_project.sources);
        let mut file_inputs = collect_file_inputs(files, sources);
        let runs_tests = self.options.load.runs_tests;
        for demotion in &roles.demoted {
            let file = demotion.file;
            if roles.has_early_error(file)
                && !may_fail_where_loaded(project, runs_tests, &bound_project.graph, file)
                && loaded_project.loaded.origin(file) != FileOrigin::EvaluatedText
            {
                file_inputs[file.idx()] = None;
            }
        }
        let names_created_on_exports = NamesCreatedOnExports::collect(
            files,
            &bound_project.graph,
            &file_inputs,
            &self.parallel_runner(),
        );
        let mut library_functions = LibraryFunctions::compute(files, &file_inputs, sources);
        library_functions.leave_out(left_out_functions);
        library_functions.leave_out_declarations(bound_project.left_out.declarations.clone());
        let erases_types = self.options.aot.erases_types && project == ProjectId::Application;
        let lowering_roles = roles_for_lowering(&roles.roles, files, erases_types);
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
        let mut lowered_files = file_inputs.iter().flatten();
        let makes_registries = project == ProjectId::Application
            && (loaded.can_load_code_at_run_time
                || lowered_files.any(|file| {
                    file.makes_registries()
                        || file.builtins.mentions_evaluator()
                        || file.builtins.loads_unknown_modules()
                }));
        let reads_source_paths =
            project == ProjectId::Application && reads_source_paths(files, sources);
        let may_have_plugins = project == ProjectId::Application
            && !self.options.load.runs_tests
            && crate::load::contents::load_names::names_plugin(files);
        if reads_source_paths {
            sources.note_source_paths_at_run_time();
        }
        let arena = files.atoms.session().arena();
        let page_manifests: Vec<(FileId, &DataValue<'_>)> = (bound_project.page_manifests.iter())
            .map(|(page, manifest)| {
                let manifest = parse_json(manifest, arena, &files.atoms);
                (*page, manifest.expect("the manifest of a page is JSON"))
            })
            .collect();
        then(&LoweringInputs {
            roles: &lowering_roles,
            builtin_types: &bound_project.builtin_types,
            named_values: &linked_project,
            builtin_names: loaded.builtin_names,
            sources,
            modules: &bound_project.graph,
            unreached_files,
            files_of_dependencies: &files_of_dependencies,
            library_functions: &library_functions,
            known_helpers: &bound_project.known_helpers,
            commonjs_exports: bound_project.graph.commonjs(),
            names_created_on_exports: &names_created_on_exports,
            files: &file_inputs,
            makes_registries,
            page_manifests: &page_manifests,
            reads_source_paths,
            may_have_plugins,
            replaced_builtins: &loaded.contents.replaced_builtins,
            fixed_builtins: &loaded.contents.fixed_builtins,
            names_added_to_builtins: &loaded.contents.names_added_to_builtins,
            limits: &self.limits,
            options: self.lowering_options(),
            said_types: &SaidTypes::default(),
        });
    }
}

fn reads_source_paths(files: &Files<'_>, sources: &Sources) -> bool {
    files.compiled_files().iter().any(|&file| {
        if !sources.has_source_path(file) {
            return false;
        }
        let decisions = &files.analysis(file).decisions;
        let mut names = files.bound(file).ident_bindings().iter();
        let mut sites = files.analysis(file).import_sites.iter();
        names.any(|&(name, binding)| {
            matches!(
                binding,
                Binding::CommonJs(CommonJsVariable::Filename | CommonJsVariable::Dirname)
            ) && !decisions.is_dead_expr(name)
        }) || sites.any(|site| {
            matches!(site.kind, ImportSiteKind::RequireResolve(call) if !decisions.is_dead_expr(call))
        })
    })
}

pub(super) fn may_fail_where_loaded(
    project: ProjectId,
    runs_tests: bool,
    graph: &ModuleGraph,
    file: FileId,
) -> bool {
    project == ProjectId::Application
        && (runs_tests || graph.is_found_by_computed_names_alone(file))
}

pub(crate) fn find_files_to_lower(
    compiled_files: &[FileId],
    roles: &RoleDecision,
    may_fail_where_loaded: impl Fn(FileId) -> bool,
) -> Vec<FileId> {
    let files = compiled_files.iter().copied();
    files
        .filter(|&file| !roles.has_early_error(file) || may_fail_where_loaded(file))
        .collect()
}

fn find_first_reported_early_errors(roles: &RoleDecision) -> Vec<(FileId, u32)> {
    let reported = (0u32..).zip(&roles.diagnostics);
    let early = reported.filter(|(_, it)| it.diagnostic.class == DiagnosticClass::EarlyError);
    let mut first: Vec<(FileId, u32)> = early
        .filter_map(|(at, it)| Some((it.diagnostic.file?, at)))
        .collect();
    first.sort_unstable();
    first.dedup_by_key(|entry| entry.0);
    first
}

fn find_files_nested_too_deeply(files: &Files<'_>, roles: &RoleDecision) -> Vec<FileId> {
    let nested_too_deeply = (roles.incomplete.iter()).filter(|it| !is_fault_of_compiler(it));
    let paths: FxHashSet<&[u8]> = nested_too_deeply.map(|it| &it.path[..]).collect();
    if paths.is_empty() {
        return Vec::new();
    }
    let compiled = files.compiled_files().iter().copied();
    let mut found: Vec<FileId> = compiled
        .filter(|&file| paths.contains(files.module(file).file_name()))
        .collect();
    found.sort_unstable();
    found
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

fn drop_reports_on_unloadable_modules(
    files: &Files<'_>,
    graph: &ModuleGraph,
    checked: &mut CheckedProgram<Option<LoweredUnit>>,
) {
    let is_lowered = |file: &FileId| {
        let found = checked.lowered.binary_search_by_key(file, |entry| entry.0);
        found.is_ok_and(|at| checked.lowered[at].1.is_some())
    };
    let lowered: FxHashSet<FileId> = graph.unloadable_files().filter(is_lowered).collect();
    let paths = lowered.iter().map(|&file| files.module(file).file_name());
    let paths: FxHashSet<&[u8]> = paths.collect();
    if !paths.is_empty() {
        checked
            .diagnostics
            .retain(|reported| match reported.diagnostic.file {
                Some(file) => !lowered.contains(&file),
                None => !paths.contains(&reported.diagnostic.path[..]),
            });
    }
}

fn drop_errors_of_modules_that_throw(
    files: &Files<'_>,
    roles: &mut RoleDecision,
    checked: &mut CheckedProgram<Option<LoweredUnit>>,
) {
    let lowered = checked.lowered.iter();
    let throwing = lowered.filter(|(_, unit)| unit.as_ref().is_some_and(|it| it.throws_at_load));
    let throwing: Vec<FileId> = throwing.map(|entry| entry.0).collect();
    if throwing.is_empty() {
        return;
    }
    let throws = |file: FileId| throwing.binary_search(&file).is_ok();
    let is_kept = |reported: &BuildDiagnostic| {
        reported.effect != Effect::StopsBuild || !reported.diagnostic.file.is_some_and(throws)
    };
    roles.diagnostics.retain(is_kept);
    checked.diagnostics.retain(is_kept);
    let paths = throwing.iter().map(|&file| files.module(file).file_name());
    let paths: FxHashSet<&[u8]> = paths.collect();
    let is_kept = |file: &Incomplete| !paths.contains(&file.path[..]) || is_fault_of_compiler(file);
    roles.incomplete.retain(is_kept);
    checked.incomplete.retain(is_kept);
}

fn is_fault_of_compiler(file: &Incomplete) -> bool {
    let mut reported = Diagnostics::new();
    reported.add_incomplete_files(core::slice::from_ref(file));
    reported.has_internal_errors()
}

fn incomplete_record_of(files: &Files<'_>, file: FileId) -> Incomplete {
    let hir = files.hir(file);
    Incomplete {
        path: files.module(file).file_name().to_vec(),
        is_nested_too_deeply: hir.ran_out_of_stack,
        deepest_nesting: match hir.ran_out_of_stack {
            true => 0,
            false => hir.deepest_nesting(),
        },
        nested_too_deeply_at: None,
    }
}

fn is_well_formed(files: &Files<'_>, file: FileId) -> bool {
    let module = files.module(file);
    let hir = files.hir(file);
    let mut classes = module.bound.class_symbol.iter();
    syntax_errors_of(hir).next().is_none()
        && !hir.ran_out_of_stack
        && !classes.any(|&it| it.is_some() && module.bound.symbol(it).name == known::missing)
}

fn with_position(mut sentence: Vec<u8>, (line, column): (u32, u32)) -> Vec<u8> {
    sentence.extend_from_slice(format!(" ({line}:{column})").as_bytes());
    sentence
}

fn finish_lowered_file(keys: &KeyContext<'_>, lowered: LoweredFile) -> LoweredUnit {
    let LoweredFile {
        fragment,
        diagnostics,
        queries,
        known_helpers,
        function_sources_reparsed,
        written_function_names,
    } = lowered;
    let functions = fragment.functions.iter().map(|(_, function)| function);
    let (mut functions_lowered, mut values_lowered) = (0, 0);
    for function in functions.filter(|it| it.role != FunctionRole::Signature) {
        functions_lowered += 1;
        values_lowered += u64::from(function.body.value_count);
    }
    LoweredUnit {
        unit: Box::new(LinkUnit::new(keys, fragment)),
        diagnostics,
        queries,
        functions_lowered,
        values_lowered,
        known_helpers,
        function_sources_reparsed,
        written_function_names,
        throws_at_load: false,
    }
}
