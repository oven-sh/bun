use super::lower_stage::may_fail_where_loaded;
use super::program_reach::{
    LeftOutCode, ProgramReachInput, ReachedModules, ReplacedLoaderHook,
    find_left_out_code_seeding_last, find_root_folders_spelled,
};
use super::summary::{collect_names_followed, collect_program_file_paths};
use super::{BoundBuild, BoundProject, Build, LoadedBuild};
use crate::builtins::{
    BuiltinValuePaths, RuntimeModule, builtin_type_paths, is_module_cache, table,
};
use crate::diagnostic_codes::Code;
use crate::diagnostics::{Diagnostic, Diagnostics, ProgramView, Span};
use crate::known_helpers::KnownHelpers;
use crate::link::run_steps_beside;
use crate::load::contents::worker_entries::source_path_of;
use crate::load::loaders::{gives_data, loader_by_path};
use crate::load::module_paths::compute_display_path;
use crate::load::source_provider::{RefusedText, SourceProvider};
use crate::load::sources::{JSON_PARSE_ERROR_FOR_BLANK_TEXT, parsed_source};
use crate::load::{PerProject, ProjectId};
use crate::module_keys::type_attribute_of;
use crate::modules::{
    self, BindInput, BoundModules, DeferredExports, LinkedProject, ModuleGraph, ModuleKind,
    ModuleRef, Shape,
};
use crate::statistics::{Stage, StepClock};
use bun_ast::Loader;
use bun_paths::is_absolute;
use bun_paths::platform::Posix;
use bun_paths::resolve_path::dirname;
use bun_sema::bind::{
    Binding, Decl, FunctionFlags, Parent, ReferentCertainty, ResolvedReferent, StaticReferent,
    static_referent,
};
use bun_sema::check::aot::{BuiltinTypeSymbols, FunctionRef};
use bun_sema::fold::{Constant, FoldedValue};
use bun_sema::hir::{ExprId, ExprKind, Flags, MemberKey, NodeData, PatKind};
use bun_sema::import_sites::ImportSiteKind;
use bun_sema::program::{CodeAnswer, CodeView, ComputedTargets, FileId, Files};
use bun_sema::resolve::CodeImportKind;
use bun_sema::util::SharedSort;
use bun_sema_driver::host::{from_argument, from_native, to_native};

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
    graph.add_imports(&reached.readers_of_built_in_modules);
}

fn key_names_no_file_of_program(files: &Files<'_>, file: FileId, entry: ExprId) -> bool {
    let (hir, analysis) = (files.hir(file), files.analysis(file));
    let path = match hir.member_key(entry) {
        Some((_, MemberKey::Name(text) | MemberKey::PrivateName(text))) => text,
        Some((_, MemberKey::Computed(key))) => {
            let key = hir.skip_type_assertions(key);
            if let Some(site) = analysis.import_site_of_call(key)
                && analysis.import_sites[site].kind == ImportSiteKind::RequireResolve(key)
            {
                let answers = files.compiled(file).map_or(&[][..], |it| it.code_answers);
                return matches!(
                    answers.get(site),
                    Some(CodeAnswer::External { .. } | CodeAnswer::NotFound(_))
                );
            }
            match analysis.decisions.constant(hir, key) {
                FoldedValue::Constant(Constant::String(path))
                | FoldedValue::ConstantOutsideDeadZone(Constant::String(path)) => path,
                FoldedValue::Constant(_)
                | FoldedValue::ConstantOutsideDeadZone(_)
                | FoldedValue::Unknown => return false,
            }
        }
        None => return false,
    };
    let path = files.atoms.bytes(path);
    !is_absolute(path) || !files.by_path.contains(&from_native(path))
}

fn hands_module_cache_to_code_out_of_sight(
    project: &LinkedProject<'_, '_>,
    file: FileId,
    handed: ExprId,
) -> bool {
    let (hir, bound) = (project.files.hir(file), project.files.bound(file));
    let named = parsed_source(project.files, file)
        .and_then(|source| source.builtins.builtin_of_expression(handed));
    if named.is_some_and(is_module_cache) {
        return true;
    }
    let mut operand = handed;
    while let Parent::Expr(parent) = bound.parent_of_expr(operand)
        && hir.type_assertion_operand(parent) == Some(operand)
    {
        operand = parent;
    }
    let Parent::Expr(user) = bound.parent_of_expr(operand) else {
        return false;
    };
    let (ExprKind::Call(call) | ExprKind::New(call)) = hir[user].kind else {
        return false;
    };
    let Some(index) = hir.ids(hir[call].args).position(|it| it == operand) else {
        return false;
    };
    let mut in_front = hir.ids(hir[call].args).take(index);
    if in_front.any(|it| matches!(hir[it].kind, ExprKind::Spread(_))) {
        return true;
    }
    let callee = hir.skip_type_assertions(hir[call].callee);
    let called = match hir[callee].kind {
        ExprKind::Fn(function) => FunctionRef { file, function },
        _ => match static_referent(project, file, callee) {
            ResolvedReferent {
                referent: StaticReferent::Function(called),
                certainty: ReferentCertainty::Proven,
            } => called,
            ResolvedReferent {
                referent: StaticReferent::Builtin(_),
                certainty: ReferentCertainty::Proven,
            } => return false,
            _ => return true,
        },
    };
    let (hir, bound) = (
        project.files.hir(called.file),
        project.files.bound(called.file),
    );
    let flags = bound.function_flags(called.function);
    if flags.contains(FunctionFlags::USES_ARGUMENTS) || !bound.runtime.eval_scopes().is_empty() {
        return true;
    }
    let parameters = hir[called.function].params;
    let rest = parameters.iter().next_back();
    let rest = rest.filter(|&last| hir[last].flags.contains(Flags::REST));
    let Some(parameter) = parameters.iter().nth(index).or(rest) else {
        return false;
    };
    let parameter = &hir[parameter];
    let symbol = bound.declared_symbol(Decl::Param(parameter.pat));
    if !matches!(hir[parameter.pat].kind, PatKind::Ident(_))
        || parameter.default.is_some()
        || parameter.flags.contains(Flags::REST)
        || !bound.is_stable_binding(symbol)
    {
        return true;
    }
    let mut reads = (0..hir.exprs.len() as u32).map(ExprId).filter(|&it| {
        matches!(hir[it].kind, ExprKind::Ident(_)) && bound.binding(it) == Binding::Symbol(symbol)
    });
    !reads.all(|read| match bound.parent_of_expr(read) {
        Parent::Expr(parent) => {
            matches!(hir[parent].kind, ExprKind::Call(call) if hir[call].callee == read)
        }
        _ => false,
    })
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
    provider: &dyn SourceProvider,
) -> Option<Vec<FileId>> {
    let (files, sources) = (view.files(), view.sources);
    let is_kept = |file: FileId| left_out.files.binary_search(&file).is_err();
    let is_data = |file: FileId| {
        let by_name = loader_by_path(loaders, files.file_name(file), CodeImportKind::Import);
        gives_data(by_name) && gives_data(sources.loader(file))
    };
    let mut has_found_data = false;
    let mut found_by_patterns: Vec<FileId> = Vec::new();
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
            found_by_patterns.extend(found.iter().filter(|&&found| is_kept(found)));
            let data = found
                .iter()
                .filter(|&&found| is_kept(found) && is_data(found));
            let mut names: Vec<&[u8]> = data
                .clone()
                .map(|&found| sources.module_paths(found).display_path)
                .collect();
            if names.is_empty() {
                continue;
            }
            has_found_data = true;
            for &found in data {
                provider.keep_bytes_of_data_file(to_native(files.module(found).file_name()));
            }
            names.shared_sort_unstable();
            let node = NodeData::Expr(site.specifier_node);
            let span = Span::of_node(files.hir(file), file, node);
            let code = Code::DataFilesFoundByPattern;
            let note = Diagnostic::new(code, Some(span), &[&names.join(&b", "[..])]);
            diagnostics.add(Some(view), note);
        }
    }
    found_by_patterns.sort_unstable();
    found_by_patterns.dedup();
    has_found_data.then_some(found_by_patterns)
}

fn warn_where_files_read_are_not_embedded(
    diagnostics: &mut Diagnostics,
    view: ProgramView<'_, '_>,
    left_out: &LeftOutCode,
    project_root: &[u8],
    provider: &dyn SourceProvider,
) {
    let (files, sources) = (view.files(), view.sources);
    let is_kept = |file: FileId| left_out.files.binary_search(&file).is_err();
    for &file in files.compiled_files().iter().filter(|&&file| is_kept(file)) {
        let folder = dirname::<Posix>(files.module(file).file_name());
        for &(operand, path) in files.analysis(file).paths_of_files_read {
            let path = from_argument(folder, files.atoms.bytes(path));
            let is_code = (files.by_path.get(&path)).is_some_and(|found| !sources.is_data(found));
            if is_code || !provider.is_file_that_only_asset_brings(to_native(&path)) {
                continue;
            }
            let span = Span::of_node(files.hir(file), file, NodeData::Expr(operand));
            let name = compute_display_path(project_root, to_native(&path));
            let code = Code::FileReadIsNotEmbedded;
            diagnostics.add(Some(view), Diagnostic::new(code, Some(span), &[&name]));
        }
    }
}

fn keep_paths_of_code_that_file_system_sees(
    view: ProgramView<'_, '_>,
    graph: &ModuleGraph,
    left_out: &LeftOutCode,
    found_by_patterns: &[FileId],
    provider: &dyn SourceProvider,
) {
    let (files, sources) = (view.files(), view.sources);
    for &file in files.compiled_files() {
        let is_seen = !sources.is_data(file)
            && left_out.files.binary_search(&file).is_err()
            && (graph.kind(file) == ModuleKind::CommonJs
                || found_by_patterns.binary_search(&file).is_ok());
        if is_seen {
            provider
                .keep_path_of_code_that_file_system_sees(to_native(files.module(file).file_name()));
        }
    }
}

fn keep_where_parsers_refused_data(
    view: ProgramView<'_, '_>,
    left_out: &LeftOutCode,
    provider: &dyn SourceProvider,
) {
    let (files, sources) = (view.files(), view.sources);
    let is_kept = |file: FileId| left_out.files.binary_search(&file).is_err();
    for &file in files.compiled_files().iter().filter(|&&file| is_kept(file)) {
        let source = parsed_source(files, file);
        let Some((loader, place)) = source.and_then(|it| it.refused_at.as_ref()) else {
            continue;
        };
        let said_by_bun_run = source
            .and_then(|it| it.parse_failure.as_deref())
            .filter(|&it| it == JSON_PARSE_ERROR_FOR_BLANK_TEXT);
        let paths = sources.module_paths(file);
        let message = [
            &b"\""[..],
            paths.display_path,
            b"\" could not be parsed as ",
            type_attribute_of(*loader).as_bytes(),
        ];
        provider.keep_where_text_is_refused(&RefusedText {
            path: paths.public_path,
            is_syntax_error: *loader == Loader::Json,
            message: said_by_bun_run.unwrap_or(&message.concat()),
            line: place.line,
            column: place.column,
            offset: place.offset,
            length: place.length,
        });
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
        self.say_why_forms_under_written_types_are_refused(loaded, &application.graph);
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

    fn say_why_forms_under_written_types_are_refused(
        &mut self,
        loaded: &LoadedBuild<'_, '_>,
        graph: &ModuleGraph,
    ) {
        let files = loaded.project(ProjectId::Application).view().files();
        let said_of = |file: FileId| {
            parsed_source(files, file).and_then(|it| it.said_where_type_is_written.as_ref())
        };
        let compiled = files.compiled_files().iter().copied();
        let refused: Vec<FileId> = compiled.filter(|&file| said_of(file).is_some()).collect();
        if refused.is_empty() {
            return;
        }
        let named_by_load_sites = graph.find_files_named_by_load_sites();
        for said in (refused.into_iter())
            .filter(|file| named_by_load_sites.binary_search(file).is_ok())
            .filter_map(said_of)
        {
            said.hand_on_to(loaded.messages);
        }
        self.diagnostics.add_load_messages(loaded.messages);
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
                let host = loaded.project(project).host;
                let found_entry_points = view.files().entry_points().iter().copied();
                let seeded_last: Vec<FileId> = found_entry_points
                    .skip(written_entry_point_count)
                    .zip(&contents.found_entry_points)
                    .filter(|&(file, found)| {
                        let name = view.files().module(file).file_name();
                        let may_start = crate::load::contents::FoundBecause::MayStartWorker;
                        let waits_for_sure_starts = found.because == may_start
                            && !found.starts.is_empty()
                            && crate::load::is_in_node_modules(name);
                        host.is_evaluated_text(name) || waits_for_sure_starts
                    })
                    .map(|(file, _)| file)
                    .collect();
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
                    || find_left_out_code_seeding_last(&input, &seeded_last, &in_parallel),
                );
                let alone = &left_out.files_alive_through_last_seeds_alone;
                loaded.project(project).loaded.hold_as_evaluated_text(alone);
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
                if !self.options.load.runs_tests && !self.options.aot.runs_in_place {
                    for &(file, entry) in &reached.deletions_from_module_cache {
                        if key_names_no_file_of_program(view.files(), file, entry) {
                            continue;
                        }
                        let hir = view.files().hir(file);
                        let span = Span::of_node(hir, file, NodeData::Expr(entry));
                        let code = Code::DeletionFromModuleCacheDoesNothing;
                        let warning = Diagnostic::new(code, Some(span), &[]);
                        self.diagnostics.add(Some(view), warning);
                    }
                    for &(file, entry) in &reached.stores_into_module_cache {
                        if key_names_no_file_of_program(view.files(), file, entry) {
                            continue;
                        }
                        let hir = view.files().hir(file);
                        let span = Span::of_node(hir, file, NodeData::Expr(entry));
                        let code = Code::EntryStoredInModuleCacheIsNotAsked;
                        let warning = Diagnostic::new(code, Some(span), &[]);
                        self.diagnostics.add(Some(view), warning);
                    }
                    let linked = LinkedProject {
                        files: view.files(),
                        graph: &graph,
                        builtin_names: loaded.builtin_names,
                        platform: self.platform,
                        library: None,
                    };
                    for &(file, place) in &reached.places_that_hand_module_cache_on {
                        if !hands_module_cache_to_code_out_of_sight(&linked, file, place) {
                            continue;
                        }
                        let hir = view.files().hir(file);
                        let span = Span::of_node(hir, file, NodeData::Expr(place));
                        let code = Code::ModuleCacheIsHandedOn;
                        let warning = Diagnostic::new(code, Some(span), &[]);
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
                    let found_by_patterns = name_data_files_found_by_patterns(
                        &mut self.diagnostics,
                        view,
                        &left_out,
                        loaders,
                        self.provider,
                    );
                    if let Some(found_by_patterns) = found_by_patterns {
                        keep_paths_of_code_that_file_system_sees(
                            view,
                            &graph,
                            &left_out,
                            &found_by_patterns,
                            self.provider,
                        );
                    }
                    keep_where_parsers_refused_data(view, &left_out, self.provider);
                    if !self.options.load.runs_tests {
                        warn_where_files_read_are_not_embedded(
                            &mut self.diagnostics,
                            view,
                            &left_out,
                            &self.options.load.project_root,
                            self.provider,
                        );
                    }
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
