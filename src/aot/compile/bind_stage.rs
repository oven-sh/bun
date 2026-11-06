use super::lower_stage::may_fail_where_loaded;
use super::program_reach::{
    LeftOutCode, ProgramReachInput, ReachedModules, ReplacedLoaderHook, find_left_out_code,
    find_root_folders_spelled,
};
use super::summary::{collect_names_followed, collect_program_file_paths};
use super::{BoundBuild, BoundProject, Build, LoadedBuild};
use crate::builtins::{BuiltinValuePaths, RuntimeModule, builtin_type_paths, table};
use crate::diagnostic_codes::Code;
use crate::diagnostics::{Diagnostic, Diagnostics, ProgramView, Span};
use crate::known_helpers::KnownHelpers;
use crate::link::run_steps_beside;
use crate::load::contents::worker_entries::source_path_of;
use crate::load::loaders::{gives_data, loader_by_path};
use crate::load::sources::parsed_source;
use crate::load::{PerProject, ProjectId};
use crate::modules::{
    self, BindInput, BoundModules, DeferredExports, ModuleGraph, ModuleKind, ModuleRef, Shape,
};
use crate::statistics::{Stage, StepClock};
use bun_ast::Loader;
use bun_sema::check::aot::BuiltinTypeSymbols;
use bun_sema::hir::{ExprId, NodeData};
use bun_sema::program::{CodeAnswer, CodeView, ComputedTargets, FileId};
use bun_sema::resolve::CodeImportKind;
use bun_sema::util::SharedSort;

fn finish_modules(graph: &mut ModuleGraph, reached: &ReachedModules) {
    for &module in &reached.looked_at {
        match graph.shape(module) {
            Shape::EsModule => graph.set_namespace_is_seen(module),
            Shape::Names | Shape::Value => graph.look_at(module),
            Shape::AsToday => {}
        }
    }
    for &module in &reached.with_module_objects {
        graph.set_keeps_module_object(module);
    }
    for &module in &reached.naming_ways {
        graph.set_names_way_to_module_objects(module);
    }
    for &module in reached
        .found_by_name
        .iter()
        .chain(&reached.data_found_by_name)
    {
        graph.set_is_found_by_name(module);
    }
    graph.leave_out_inner_modules(&reached.left_out_inner_modules);
    graph.limit_requests(|referrer, request| reached.keeps_request(referrer, request));
}

fn warn_where_modules_are_reset(
    diagnostics: &mut Diagnostics,
    view: ProgramView<'_, '_>,
    left_out: &LeftOutCode,
) {
    let files = view.files();
    for &file in files.compiled_files() {
        let Some(source) = parsed_source(files, file) else {
            continue;
        };
        if !source.builtins.loses_sight_of_module_cache()
            || left_out.files.binary_search(&file).is_ok()
        {
            continue;
        }
        let hir = files.hir(file);
        for expression in (0..hir.exprs.len() as u32).map(ExprId) {
            let named = source.builtins.builtin_of_expression(expression);
            if named.is_some_and(table::resets_modules) {
                let span = Span::of_node(hir, file, NodeData::Expr(expression));
                let code = Code::ModulesLoadAgainUncompiled;
                diagnostics.add(Some(view), Diagnostic::new(code, Some(span), &[]));
            }
        }
    }
}

fn name_data_files_found_by_patterns(
    diagnostics: &mut Diagnostics,
    view: ProgramView<'_, '_>,
    left_out: &LeftOutCode,
    loaders: &[(Vec<u8>, Loader)],
) {
    let (files, sources) = (view.files(), view.sources);
    let is_kept = |file: FileId| left_out.files.binary_search(&file).is_err();
    let is_data = |file: FileId| {
        let by_name = loader_by_path(loaders, files.file_name(file), CodeImportKind::Import);
        gives_data(sources.loader(file)) && gives_data(by_name)
    };
    for &file in files.compiled_files().iter().filter(|&&file| is_kept(file)) {
        let Some((answers, _)) = files.answers(file) else {
            continue;
        };
        let sites = files.analysis(file).import_sites.iter().zip(answers);
        for (site, answer) in sites.filter(|(site, _)| site.kind.loads_module()) {
            let CodeAnswer::Computed(ComputedTargets::Modules { files: found, .. }) = *answer
            else {
                continue;
            };
            let data = found
                .iter()
                .filter(|&&found| is_kept(found) && is_data(found));
            let mut names: Vec<&[u8]> = data
                .map(|&found| sources.module_paths(found).display_path)
                .collect();
            if names.is_empty() {
                continue;
            }
            names.shared_sort_unstable();
            let node = NodeData::Expr(site.specifier_node);
            let span = Span::of_node(files.hir(file), file, node);
            let code = Code::DataFilesFoundByPattern;
            let note = Diagnostic::new(code, Some(span), &[&names.join(&b", "[..])]);
            diagnostics.add(Some(view), note);
        }
    }
}

struct BoundGraph {
    graph: ModuleGraph,
    left_out: LeftOutCode,
    known_helpers: KnownHelpers,
}

impl BoundGraph {
    fn with_builtin_types(self, builtin_types: BuiltinTypeSymbols) -> BoundProject {
        BoundProject {
            graph: self.graph,
            left_out: self.left_out,
            known_helpers: self.known_helpers,
            builtin_types,
            page_manifests: Vec::new(),
        }
    }
}

impl Build<'_> {
    fn runner_starts_entry_points(&self) -> bool {
        self.options.load.runs_tests
    }

    pub(crate) fn bind_modules(
        &mut self,
        loaded: &LoadedBuild<'_, '_>,
    ) -> Result<BoundBuild, Stage> {
        self.clock.start(Stage::BindModules);
        let platform = self.platform;
        let mut steps = StepClock::new(Stage::BindModules);
        let library = loaded.project(ProjectId::Runtime).view();
        let deferred_exports = DeferredExports::collect(library.files(), library.sources);
        steps.end("deferred exports");
        let projects = loaded.projects.as_ref();
        let files = projects.map(|_, project| project.loaded.files());
        let find_builtin_types = move || {
            let types = builtin_type_paths();
            files.map(|_, files| {
                let values = Box::new(move || BuiltinValuePaths::list_of(platform));
                BuiltinTypeSymbols::compute(files, &types, values)
            })
        };
        let (builtin_types, (application, runtime)) = run_steps_beside(
            &self.beside_runner(),
            &mut steps,
            ["types of built-ins", "both projects"],
            find_builtin_types,
            || {
                let application =
                    self.bind_project(loaded, ProjectId::Application, &deferred_exports, &[]);
                let mocked = application.graph.mocked_library_modules();
                let runtime =
                    self.bind_project(loaded, ProjectId::Runtime, &deferred_exports, mocked);
                (application, runtime)
            },
        );
        let page_manifests = self.bundle_pages(loaded, &application.graph);
        if application.graph.errors().is_empty() {
            let provider = self.provider;
            let _ = loaded
                .messages
                .with_log(|log| provider.check_embedded_files(log));
            self.diagnostics.add_load_messages(loaded.messages);
        }
        steps.end("pages, embedded files");
        Ok(BoundBuild {
            projects: PerProject {
                application: BoundProject {
                    page_manifests,
                    ..application.with_builtin_types(builtin_types.application)
                },
                runtime: runtime.with_builtin_types(builtin_types.runtime),
            },
        })
    }

    fn bundle_pages(
        &mut self,
        loaded: &LoadedBuild<'_, '_>,
        graph: &ModuleGraph,
    ) -> Vec<(FileId, Vec<u8>)> {
        let has_no_bundle = self.options.load.runs_tests || self.options.aot.runs_in_place;
        if has_no_bundle || !graph.errors().is_empty() {
            return Vec::new();
        }
        let view = loaded.project(ProjectId::Application).view();
        let (files, sources) = (view.files(), view.sources);
        let is_page = |file: &FileId| {
            sources.is_data(*file)
                && sources.loader(*file) == Loader::Html
                && !graph.is_left_out(ModuleRef::File(*file))
        };
        let compiled = files.compiled_files().iter().copied();
        let mut pages: Vec<FileId> = compiled.filter(is_page).collect();
        if pages.is_empty() {
            return Vec::new();
        }
        let named_by_load_sites = graph.find_files_named_by_load_sites();
        pages.retain(|page| {
            let mut entry_points = sources.entry_points().iter();
            named_by_load_sites.binary_search(page).is_ok()
                || entry_points.any(|entry_point| entry_point.file == *page)
        });
        pages.sort_unstable();
        let path_of = |&page: &FileId| {
            let source = parsed_source(files, page);
            match source.and_then(|source| source.plugin_module.as_ref()) {
                Some(module) => &*module.path,
                None => sources.diagnostic_path(page),
            }
        };
        let paths: Vec<&[u8]> = pages.iter().map(path_of).collect();
        let provider = self.provider;
        let manifests = loaded
            .messages
            .with_log(|log| provider.bundle_pages(&paths, log));
        self.diagnostics.add_load_messages(loaded.messages);
        let Ok(manifests) = manifests else {
            return Vec::new();
        };
        assert_eq!(manifests.len(), pages.len(), "one manifest for each page");
        pages.into_iter().zip(manifests).collect()
    }

    fn bind_project(
        &mut self,
        loaded: &LoadedBuild<'_, '_>,
        project: ProjectId,
        deferred_exports: &DeferredExports,
        mocked_library_modules: &[RuntimeModule],
    ) -> BoundGraph {
        let in_parallel = self.parallel_runner();
        let beside = self.beside_runner();
        let view = loaded.project(project).view();
        let contents = loaded.contents;
        let external_packages: &[Vec<u8>] = match project {
            ProjectId::Application => &self.options.load.externals.packages,
            ProjectId::Runtime => &[],
        };
        let written_entry_point_count = match project {
            ProjectId::Application => self.options.entry_points.len(),
            ProjectId::Runtime => view.files().entry_points().len(),
        };
        let mut steps = StepClock::new(Stage::BindModules);
        let project_name = match project {
            ProjectId::Application => "application",
            ProjectId::Runtime => "library",
        };
        let mut known_helpers = KnownHelpers::compute_below_added_names(
            view.files(),
            &contents.names_added_to_builtins,
            &in_parallel,
        );
        known_helpers.keep_private_states_in_collections(&contents.replaced_builtins);
        steps.end_with(|| format!("{project_name}: known helpers"));
        let run_of_library = crate::test_runs::RunContents::default();
        let plugin_answers_for_names_left_to_host = project == ProjectId::Application
            && !self.options.load.runs_tests
            && !self.options.load.externals.is_empty()
            && crate::load::contents::load_names::names_plugin(view.files());
        let files_are_named_out_of_sight =
            self.options.code_from_disk_names_files() || plugin_answers_for_names_left_to_host;
        let BoundModules { mut graph } = modules::bind_modules(&BindInput {
            files: view.files(),
            sources: view.sources,
            builtin_names: loaded.builtin_names,
            deferred_exports,
            known_helpers: &known_helpers,
            platform: self.platform,
            external_packages,
            replaced_builtins: &contents.replaced_builtins,
            names_added_to_builtins: &contents.names_added_to_builtins,
            runs_in_place: self.options.aot.runs_in_place,
            ignores_declared_side_effects: self.options.code.ignores_declared_side_effects,
            mocks_any_module: project == ProjectId::Application && contents.mocks_any_module,
            mocked_library_modules,
            hands_on_any_module: contents.loads_by_unknown_name
                || contents.loads_by_unknown_path
                || (project == ProjectId::Application
                    && contents.run.loader_functions_answer_requires),
            any_module_loads_again: self.options.load.runs_tests && contents.any_module_loads_again,
            runs_tests: self.options.load.runs_tests,
            runner_starts_entry_points: project == ProjectId::Application
                && self.runner_starts_entry_points(),
            written_entry_point_count,
            entry_points_run_again: project == ProjectId::Application
                && self.options.aot.entry_points_run_again,
            typescript_drops_absent_exports: project == ProjectId::Application
                && self.options.aot.typescript_drops_absent_exports,
            runs_in_several_realms: project == ProjectId::Application
                && self.options.aot.runs_in_several_realms,
            files_are_named_out_of_sight: files_are_named_out_of_sight
                && !self.stays_in_compiled_files,
            helpers_of_tests_name_files: self.options.load.runs_tests
                && !self.stays_in_compiled_files,
            run: match project {
                ProjectId::Application => &contents.run,
                ProjectId::Runtime => &run_of_library,
            },
            in_parallel: &in_parallel,
            beside: &beside,
        });
        if project == ProjectId::Application
            && crate::load::contents::load_names::mentions_plugin(view.files())
        {
            self.started_workers.names_plugin = true;
            if self.options.load.runs_tests {
                graph.set_lists_names_of_statements();
            }
        }
        if project == ProjectId::Application && contents.stores_loader_functions {
            graph.set_asks_loader_functions();
        }
        if crate::load::contents::load_names::does_some_file_answer_for_names(view.files()) {
            graph.set_answers_for_names_itself();
        }
        steps.end_with(|| format!("{project_name}: bind modules"));
        self.diagnostics.add_module_failures(view, &graph);
        let runs_tests = self.options.load.runs_tests;
        let files = view.files();
        let compiled = files.compiled_files().iter().copied();
        for file in compiled.filter(|&file| !files.analysis(file).errors.is_empty()) {
            let throws_its_error = graph.load_failure(file).is_some()
                || (graph.kind(file) == ModuleKind::CommonJs
                    && may_fail_where_loaded(project, runs_tests, &graph, file));
            if !throws_its_error {
                self.diagnostics.add_fold_errors(view, file);
            }
        }
        steps.end_with(|| format!("{project_name}: failures of modules, errors of folding"));
        let left_out = match project {
            ProjectId::Application if graph.errors().is_empty() => {
                let files_are_named_out_of_sight = !self.options.load.runs_tests
                    && !graph.importers_of_uncompiled_code().is_empty()
                    && (self.options.aot.runs_in_place || files_are_named_out_of_sight);
                let entry_points = view.files().entry_points().iter().copied();
                let mut files_started_by_runner: Vec<_> = entry_points
                    .take(written_entry_point_count)
                    .filter(|_| self.runner_starts_entry_points())
                    .collect();
                files_started_by_runner.sort_unstable();
                let found = view.files().entry_points().get(written_entry_point_count..);
                let found = found
                    .unwrap_or_default()
                    .iter()
                    .zip(&contents.found_entry_points);
                let mut starts_of_workers: Vec<(FileId, ExprId, FileId)> = found
                    .flat_map(|(&entry_point, found)| {
                        let starts = found.starts.iter();
                        starts.map(move |&(file, at)| (file, ExprId(at), entry_point))
                    })
                    .collect();
                starts_of_workers
                    .sort_unstable_by_key(|&(file, at, entry_point)| (file, at.0, entry_point));
                let input = ProgramReachInput {
                    files: view.files(),
                    sources: view.sources,
                    graph: &graph,
                    known_helpers: &known_helpers,
                    removable: self.options.removable,
                    counts_executions: self.options.aot.counts_executions,
                    any_file_is_named_at_run_time: files_are_named_out_of_sight
                        || self.options.aot.admits_inspector
                        || (!self.stays_in_compiled_files && self.options.load.runs_tests),
                    files_are_named_out_of_sight,
                    admits_inspector: self.options.aot.admits_inspector,
                    isolates_code_from_disk: self.options.aot.isolates_code_from_disk,
                    mocks_any_module: contents.mocks_any_module || contents.stores_loader_functions,
                    files_started_by_runner: &files_started_by_runner,
                    starts_of_workers: &starts_of_workers,
                    beside: &beside,
                };
                let lists_program_files = !self.options.aot.runs_in_place;
                steps.end_with(|| format!("{project_name}: what is asked ahead of the reach"));
                let (program_files, (left_out, reached)) = run_steps_beside(
                    &beside,
                    &mut steps,
                    ["paths of the files of the program", "find left out code"],
                    || match lists_program_files {
                        true => collect_program_file_paths(view.files(), view.sources),
                        false => Vec::new(),
                    },
                    || find_left_out_code(&input, &in_parallel),
                );
                let held = program_files.into_iter();
                let held = held.filter(|(file, _)| left_out.files.binary_search(file).is_err());
                self.started_workers.program_files = held.map(|(_, paths)| paths).collect();
                if !self.options.aot.runs_in_place {
                    self.started_workers.names_followed =
                        collect_names_followed(view.files(), view.sources, &graph, &left_out.files);
                }
                for &module in &reached.looked_at {
                    if let crate::modules::ModuleRef::File(file) = module {
                        assert!(
                            !graph.leaves_out_star_names(file),
                            "something looks at the object of {}, and nobody was seen to ask for all that `export *` brings it",
                            bstr::BStr::new(view.sources.module_paths(file).display_path),
                        );
                    }
                }
                finish_modules(&mut graph, &reached);
                if reached.stores_loader_function {
                    graph.set_computed_names_ask_loader_functions();
                }
                steps.end_with(|| format!("{project_name}: finish modules"));
                if !self.options.load.runs_tests {
                    for &replaced in &reached.replaced_loader_hooks {
                        let ReplacedLoaderHook {
                            file,
                            assignment,
                            hook,
                        } = replaced;
                        let hir = view.files().hir(file);
                        let span = Span::of_node(hir, file, NodeData::Expr(assignment));
                        let code = Code::LoaderFunctionNotAsked;
                        let warning = Diagnostic::new(code, Some(span), &[hook.name()]);
                        self.diagnostics.add(Some(view), warning);
                    }
                }
                if !reached.found_by_name.is_empty() {
                    self.started_workers.root_folders_spelled = find_root_folders_spelled(
                        view.files(),
                        view.sources,
                        &self.options.paths.root_directory,
                        &in_parallel,
                    );
                }
                steps.end_with(|| format!("{project_name}: root folders that paths spell"));
                warn_where_modules_are_reset(&mut self.diagnostics, view, &left_out);
                if !self.options.aot.runs_in_place {
                    let loaders = &self.options.load.loaders;
                    name_data_files_found_by_patterns(
                        &mut self.diagnostics,
                        view,
                        &left_out,
                        loaders,
                    );
                }
                crate::test_run_loads::warn_where_every_file_may_load_again(
                    &mut self.diagnostics,
                    view,
                    &contents.run.loads,
                    &left_out.files,
                );
                steps.end_with(|| format!("{project_name}: warnings"));
                graph.leave_out_files(&left_out.files, &in_parallel);
                for &(_, _, entry_point) in &starts_of_workers {
                    if left_out.files.binary_search(&entry_point).is_ok() {
                        let path = source_path_of(view.files().module(entry_point).file_name());
                        let names = &mut self.started_workers.names;
                        names.retain(|name| name.source_path != path);
                    }
                }
                steps.end_with(|| format!("{project_name}: leave out files"));
                graph.limit_exports(&in_parallel, &|file, export| {
                    left_out.find_export_use(file, export)
                });
                steps.end_with(|| format!("{project_name}: limit exports"));
                left_out
            }
            ProjectId::Application | ProjectId::Runtime => LeftOutCode::default(),
        };
        graph.finish_plan(&in_parallel);
        steps.end_with(|| format!("{project_name}: finish the plan"));
        if let Some((root, owner)) = graph.find_check_of_copy_that_nothing_stores() {
            let path_of = |file: bun_sema::program::FileId| {
                bstr::BStr::new(view.sources.module_paths(file).display_path)
            };
            let owner = match owner {
                crate::modules::ModuleRef::File(file) | crate::modules::ModuleRef::Face(file) => {
                    path_of(file)
                }
                _ => bstr::BStr::new("a module that is no file"),
            };
            panic!(
                "{} would look for a name of {owner} before anything has run that file",
                path_of(root),
            );
        }
        BoundGraph {
            graph,
            left_out,
            known_helpers,
        }
    }
}
