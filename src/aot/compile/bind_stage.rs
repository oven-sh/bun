use super::program_reach::{
    LeftOutCode, ProgramReachInput, ReachedModules, find_left_out_code, find_root_folders_spelled,
    imports_file_with_query,
};
use super::summary::collect_program_file_paths;
use super::{BoundBuild, BoundProject, Build, LoadedBuild};
use crate::builtins::{
    BuiltinId, BuiltinValuePaths, RuntimeModule, builtin_type_paths, count_types_degraded_to_views,
    table,
};
use crate::known_helpers::KnownHelpers;
use crate::link::run_beside;
use crate::load::replaced_modules::find_what_packages_do_with_test_runner;
use crate::load::{PerProject, ProjectId};
use crate::modules::{
    self, BindInput, BoundModules, DeferredData, DeferredExports, ModuleGraph, Shape,
};
use crate::options::{ReplacedExport, ReplacedModule};
use crate::statistics::{Stage, StatisticId};
use bun_sema::check::aot::BuiltinTypeSymbols;
use bun_sema_driver::host::to_native;

/// What the look through the test files found, for a program that lies below them.
fn tests_store_loader_functions(builtins: &[u32], exports: &[ReplacedExport]) -> bool {
    let is_stored = |builtin: Option<BuiltinId>| {
        matches!(
            builtin.map(table::canonical_id),
            Some(BuiltinId::NodeModule_resolveFilename | BuiltinId::NodeModulePrototypeRequire)
        )
    };
    builtins
        .iter()
        .any(|&builtin| is_stored(BuiltinId::from_wire(builtin)))
        || exports.iter().any(|export| {
            let module = match &export.module {
                ReplacedModule::File(specifier) => table::module_by_specifier(specifier),
                ReplacedModule::Runtime(id) => RuntimeModule::from_registry_id(*id),
            };
            module == Some(RuntimeModule::NodeModule)
                && is_stored(
                    table::find_name(&export.name)
                        .and_then(|name| table::own_member(BuiltinId::NodeModule, name)),
                )
        })
}

// The text of a module says which shapes it can have. What the reached code does with the module says which one it has.
fn finish_modules(graph: &mut ModuleGraph, reached: &ReachedModules) {
    for &module in &reached.looked_at {
        match graph.shape(module) {
            Shape::EsModule => graph.set_namespace_is_seen(module),
            // Of a module that hands on what another one exports, that one is in the list too.
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
    graph.set_ways_not_followed_out_of_sight(reached.ways_not_followed_out_of_sight);
    graph.set_ways_followed_for_their_names(reached.ways_followed_for_their_names);
    graph.set_lets_process_out_of_sight(reached.lets_process_out_of_sight);
    graph.set_is_ready_for_loader_functions(reached.is_ready_for_loader_functions);
    graph.leave_out_inner_modules(&reached.left_out_inner_modules);
    graph.set_files_brought_by_calls(reached.brought_by_calls.clone());
    graph.limit_requests(|referrer, request| reached.keeps_request(referrer, request));
}

impl Build<'_> {
    pub(crate) fn bind_modules<'s>(
        &mut self,
        loaded: &LoadedBuild<'_, 's>,
    ) -> Result<BoundBuild<'s>, Stage> {
        self.clock.start(Stage::BindModules);
        let platform = self.platform;
        let library = loaded.project(ProjectId::Runtime).view();
        let deferred_exports = DeferredExports::collect(library.files(), library.sources);
        let projects = loaded.projects.as_ref();
        let files = projects.map(|_, project| project.loaded.files());
        let find_builtin_types = move || {
            let types = builtin_type_paths();
            files.map(|_, files| {
                let values = Box::new(move || BuiltinValuePaths::list_of(platform));
                BuiltinTypeSymbols::compute(files, &types, values)
            })
        };
        let (builtin_types, graphs) =
            run_beside(&self.beside_runner(), find_builtin_types, || PerProject {
                application: self.bind_project(loaded, ProjectId::Application, &deferred_exports),
                runtime: self.bind_project(loaded, ProjectId::Runtime, &deferred_exports),
            });
        for (_, types) in builtin_types.iter() {
            self.statistics.count(
                StatisticId::BuiltinTypesDegradedToViews,
                count_types_degraded_to_views(types),
            );
        }
        Ok(BoundBuild {
            projects: PerProject {
                application: (graphs.application)(builtin_types.application),
                runtime: (graphs.runtime)(builtin_types.runtime),
            },
        })
    }

    fn bind_project<'s>(
        &mut self,
        loaded: &LoadedBuild<'_, 's>,
        project: ProjectId,
        deferred_exports: &DeferredExports,
    ) -> impl FnOnce(BuiltinTypeSymbols) -> BoundProject<'s> + use<'s> {
        let in_parallel = self.parallel_runner();
        let beside = self.beside_runner();
        let view = loaded.project(project).view();
        let external_packages: &[Vec<u8>] = match project {
            ProjectId::Application => &self.options.load.externals.packages,
            ProjectId::Runtime => &[],
        };
        // A call of a helper that a compiler or a bundler wrote says what a module exports, and where a module begins.
        let mut known_helpers = KnownHelpers::compute(view.files(), &in_parallel);
        known_helpers.keep_private_states_in_collections(&self.options.load.replaced_builtins);
        let application = match project {
            ProjectId::Application => loaded.application,
            ProjectId::Runtime => None,
        };
        let replaced_exports: &[ReplacedExport] = match project {
            ProjectId::Application => &self.options.load.replaced_exports,
            ProjectId::Runtime => &[],
        };
        // `mock.module("bun:wrap", factory)`: an ES module of Bun's own is compiled like a file, and a mock replaces its exports as it replaces a file's.
        let mocked_modules: Vec<ReplacedModule> = match project {
            ProjectId::Application => Vec::new(),
            ProjectId::Runtime => (self.options.load.mocked_modules.iter())
                .filter(|module| modules::names_es_module_of_library(module))
                .cloned()
                .collect(),
        };
        let stand_in = self.options.load.stand_in_for_files_from_disk.as_deref();
        let stand_in = stand_in.filter(|_| project == ProjectId::Application);
        let stand_in_for_files_from_disk = stand_in.and_then(|path| {
            let mut entry_points = view.sources.entry_points().iter().map(|it| it.file);
            entry_points.find(|&file| to_native(view.files().module(file).file_name()) == path)
        });
        let BoundModules {
            mut graph,
            counters,
        } = modules::bind_modules(&BindInput {
            files: view.files(),
            sources: view.sources,
            builtin_names: loaded.builtin_names,
            deferred_exports,
            platform: self.platform,
            external_packages,
            replaced_exports,
            replaced_builtins: &self.options.load.replaced_builtins,
            runs_in_place: self.options.aot.runs_in_place,
            working_directory: &self.options.code.working_directory,
            ignores_declared_side_effects: self.options.code.ignores_declared_side_effects,
            mocked_modules: match project {
                ProjectId::Application => &self.options.load.mocked_modules,
                ProjectId::Runtime => &mocked_modules,
            },
            mocks_any_module: project == ProjectId::Application && self.mocks_any_module(),
            handed_on_modules: match project {
                ProjectId::Application => &self.options.load.handed_on_modules,
                ProjectId::Runtime => &[],
            },
            hands_on_any_module: self.options.load.hands_on_any_module,
            spies_on_unknown_objects: self.options.load.spies_on_unknown_objects,
            names_spied_on_unknown_objects: &self.options.load.names_spied_on_unknown_objects,
            names_spied_in_text: &self.options.load.names_spied_in_text,
            modules_replaced_in_text: &self.options.load.modules_replaced_in_text,
            every_export_is_asked_for: self.options.load.every_export_is_asked_for,
            evicted_modules: match project {
                ProjectId::Application => &self.options.load.evicted_modules,
                ProjectId::Runtime => &[],
            },
            evicts_any_module: self.options.load.evicts_any_module,
            loads_below_files_left_to_loader: match project {
                ProjectId::Application => &self.options.load.loads_below_files_left_to_loader,
                ProjectId::Runtime => &[],
            },
            files_that_tests_load: &self.options.load.files_that_tests_load,
            runs_tests: self.options.load.runs_tests,
            runner_starts_entry_points: project == ProjectId::Application
                && self.options.load.runs_tests
                && (self.options.aot.is_part_of_test_files || !self.options.aot.shares_realms),
            stores_path_of_main_module: self.options.load.stores_path_of_main_module,
            entry_points_run_again: project == ProjectId::Application
                && self.options.aot.entry_points_run_again,
            typescript_drops_absent_exports: project == ProjectId::Application
                && self.options.aot.typescript_drops_absent_exports,
            loads_code_from_disk: self.options.aot.loads_code_from_disk,
            host_runs_files_from_disk: self.options.aot.host_runs_files_from_disk,
            stand_in_for_files_from_disk,
            application: application.map(|application| &application.graph),
            known_helpers: &known_helpers,
            in_parallel: &in_parallel,
            beside: &beside,
        });
        self.diagnostics.add_module_failures(view, &graph);
        self.statistics.add_counters(view, counters);
        if project == ProjectId::Application {
            self.statistics.log_computed_imports();
        }
        // A program of test files over other programs holds the test files alone: what they import is below.
        if project == ProjectId::Application
            && self.options.aot.is_part_of_test_files
            && crate::statistics::logs_stages()
        {
            let entry_points = &self.options.entry_points;
            let paths = collect_program_file_paths(view.files(), view.sources);
            let others: Vec<&[u8]> = (paths.iter().map(|file| file.source_path.as_slice()))
                .filter(|path| !entry_points.iter().any(|entry| entry.as_slice() == *path))
                .collect();
            bun_core::print_errorln!(
                "AOT part build | files compiled that are no test files of the part | {} of {} | {}",
                others.len(),
                paths.len(),
                bstr::BStr::new(&others.join(&b" "[..])),
            );
        }
        // The first program of the realm holds all of Bun's own code, so what is counted here is compiled once more.
        if project == ProjectId::Runtime
            && self.options.aot.is_part_of_test_files
            && crate::statistics::logs_stages()
        {
            bun_core::print_errorln!(
                "AOT part build | files of Bun's own code compiled | {}",
                view.files().compiled_files().len(),
            );
        }
        let left_out = match (project, application) {
            (_, Some(application)) => {
                let left_out = application.left_out;
                let mut left_out = left_out.in_other_program(application.graph.to_local);
                let compiled_files = view.files().compiled_files().iter().copied();
                left_out.leave_out_files(
                    compiled_files.filter(|&file| !application.graph.has_module(file)),
                );
                graph.adopt_plan(&application.graph);
                graph.leave_out_files(&left_out.files, &in_parallel);
                graph.limit_exports(&in_parallel, &|file, export| {
                    left_out.find_export_use(file, export)
                });
                left_out
            }
            (ProjectId::Application, None) if graph.errors().is_empty() => {
                // In a test run a program names the files of the programs below it as it names a package on disk.
                let code_on_disk_names_files = !self.options.load.runs_tests
                    && !self.options.aot.host_runs_files_from_disk
                    && (self.options.aot.loads_code_from_disk || self.options.aot.runs_in_place)
                    && !graph.importers_of_uncompiled_code().is_empty();
                let input = ProgramReachInput {
                    files: view.files(),
                    sources: view.sources,
                    graph: &graph,
                    known_helpers: &known_helpers,
                    removable: self.options.removable,
                    limits: &self.limits,
                    reads_main_module_without_its_name: (self.options.load)
                        .reads_main_module_without_its_name,
                    stores_path_of_main_module: self.options.load.stores_path_of_main_module,
                    stores_loader_functions: self.options.load.stores_loader_functions,
                    asks_loader_functions_once_stored: self.options.load.runs_tests,
                    ways_read_out_of_sight: self.options.load.ways_read_out_of_sight,
                    any_file_is_named_at_run_time: code_on_disk_names_files
                        || (!self.options.aot.host_runs_files_from_disk
                            && (self.options.aot.loads_code_from_disk
                                || self.options.load.runs_tests)),
                    code_on_disk_names_files,
                    mocks_any_module: self.mocks_any_module(),
                    host_runs_files_from_disk: self.options.aot.host_runs_files_from_disk,
                };
                self.started_workers.imports_file_with_query = self.options.load.runs_tests
                    && !self.options.aot.loads_code_from_disk
                    && imports_file_with_query(view.files(), view.sources);
                if self.options.aot.loads_code_from_disk && !self.options.aot.runs_in_place {
                    self.started_workers.program_files =
                        collect_program_file_paths(view.files(), view.sources);
                }
                let nobody_reads = self.options.load.ways_named_that_nobody_reads;
                let (left_out, reached) = find_left_out_code(&input, nobody_reads, &in_parallel);
                finish_modules(&mut graph, &reached);
                let asks_loader_functions = self.options.load.runs_tests
                    && (reached.stores_loader_functions
                        || self.options.load.stores_loader_functions
                        || tests_store_loader_functions(
                            &self.options.load.replaced_builtins,
                            &self.options.load.replaced_exports,
                        ));
                graph.set_asks_loader_functions(asks_loader_functions);
                self.replaced_builtins.stores_loader_functions |= asks_loader_functions;
                self.replaced_builtins.evicts_any_module |= graph.may_evict_every_module();
                if self.options.load.runs_tests {
                    let in_packages = find_what_packages_do_with_test_runner(view.files());
                    let told_above = &mut self.replaced_builtins;
                    told_above.any_module |= in_packages.mocks_any_module;
                    told_above.spies_on_unknown_objects |= in_packages.spies_on_unknown_objects;
                    (told_above.names_spied_on_unknown_objects)
                        .extend(in_packages.names_spied_on_unknown_objects);
                }
                if !reached.found_by_name.is_empty() {
                    self.started_workers.root_folders_spelled = find_root_folders_spelled(
                        view.files(),
                        view.sources,
                        &self.options.paths.root_directory,
                    );
                }
                graph.leave_out_files(&left_out.files, &in_parallel);
                graph.limit_exports(&in_parallel, &|file, export| {
                    left_out.find_export_use(file, export)
                });
                left_out
            }
            (ProjectId::Application | ProjectId::Runtime, None) => LeftOutCode::default(),
        };
        graph.finish_plan(&in_parallel);
        if self.options.aot.imports_are_in_other_images {
            graph.join_externals_that_spell_paths(&view.files().atoms);
        }
        let deferred_data = match project {
            ProjectId::Application if application.is_some() => DeferredData::default(),
            ProjectId::Application => self.bundle_pages(loaded, &graph),
            ProjectId::Runtime => DeferredData::default(),
        };
        move |builtin_types| BoundProject {
            graph,
            left_out,
            known_helpers,
            deferred_data,
            builtin_types,
        }
    }

    fn bundle_pages<'s>(
        &mut self,
        loaded: &LoadedBuild<'_, 's>,
        graph: &ModuleGraph,
    ) -> DeferredData<'s> {
        if !graph.errors().is_empty() {
            return DeferredData::default();
        }
        let sources = &loaded.project(ProjectId::Application).sources;
        let (provider, arena) = (self.provider, loaded.session.arena());
        let named_by_load_sites = graph.find_files_named_by_load_sites();
        let is_loaded = |file: bun_sema::program::FileId| {
            let mut entry_points = sources.entry_points().iter();
            named_by_load_sites.binary_search(&file).is_ok()
                || entry_points.any(|entry_point| entry_point.file == file)
        };
        let bundled = loaded.messages.with_log(|log| {
            modules::bundle_pages(sources, provider, &is_loaded, arena, &loaded.atoms, log)
        });
        self.diagnostics.add_load_messages(loaded.messages);
        bundled.unwrap_or_default()
    }
}
