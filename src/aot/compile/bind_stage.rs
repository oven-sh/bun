use super::program_reach::{LeftOutCode, ProgramReachInput, ReachedModules, find_left_out_code};
use super::{BoundBuild, BoundProject, Build, LoadedBuild};
use crate::builtins::{BuiltinValuePaths, builtin_type_paths, count_types_degraded_to_views};
use crate::known_helpers::KnownHelpers;
use crate::link::run_beside;
use crate::load::{PerProject, ProjectId};
use crate::modules::{
    self, BindInput, BoundModules, DeferredData, DeferredExports, ModuleGraph, Shape,
};
use crate::statistics::{Stage, StatisticId};
use bun_sema::check::aot::BuiltinTypeSymbols;

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
    graph.leave_out_inner_modules(&reached.left_out_inner_modules);
    graph.limit_requests(|referrer, request| reached.keeps_request(referrer, request));
}

impl Build<'_> {
    pub(crate) fn bind_modules<'s>(
        &mut self,
        loaded: &LoadedBuild<'_, 's>,
    ) -> Result<BoundBuild<'s>, Stage> {
        self.clock.start(Stage::BindModules);
        let value_paths = BuiltinValuePaths::collect(self.platform);
        let library = loaded.project(ProjectId::Runtime).view();
        let deferred_exports = DeferredExports::collect(library.files(), library.sources);
        let projects = loaded.projects.as_ref();
        let files = projects.map(|_, project| project.loaded.files());
        let find_builtin_types = move || {
            let (types, values) = (builtin_type_paths(), value_paths.paths());
            files.map(|_, files| BuiltinTypeSymbols::compute(files, &types, &values))
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
        let view = loaded.project(project).view();
        let external_packages: &[Vec<u8>] = match project {
            ProjectId::Application => &self.options.load.externals.packages,
            ProjectId::Runtime => &[],
        };
        // A call of a helper that a compiler or a bundler wrote says what a module exports, and where a module begins.
        let known_helpers = KnownHelpers::compute(view.files(), &in_parallel);
        let application = match project {
            ProjectId::Application => loaded.application,
            ProjectId::Runtime => None,
        };
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
            application: application.map(|application| &application.graph),
            known_helpers: &known_helpers,
            in_parallel: &in_parallel,
        });
        self.diagnostics.add_module_failures(view, &graph);
        self.statistics.add_counters(view, counters);
        let left_out = match (project, application) {
            (_, Some(application)) => {
                let left_out = application.left_out;
                let left_out = left_out.in_other_program(application.graph.to_local);
                graph.adopt_plan(&application.graph);
                graph.leave_out_files(&left_out.files, &in_parallel);
                graph.limit_exports(&in_parallel, &|file, export| {
                    left_out.find_export_use(file, export)
                });
                left_out
            }
            (ProjectId::Application, None) if graph.errors().is_empty() => {
                let input = ProgramReachInput {
                    files: view.files(),
                    sources: view.sources,
                    graph: &graph,
                    removable: self.options.removable,
                };
                let (left_out, reached) = find_left_out_code(&input, &in_parallel);
                finish_modules(&mut graph, &reached);
                graph.leave_out_files(&left_out.files, &in_parallel);
                graph.limit_exports(&in_parallel, &|file, export| {
                    left_out.find_export_use(file, export)
                });
                left_out
            }
            (ProjectId::Application | ProjectId::Runtime, None) => LeftOutCode::default(),
        };
        graph.finish_plan(&in_parallel);
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
        let bundled = loaded
            .messages
            .with_log(|log| modules::bundle_pages(sources, provider, arena, &loaded.atoms, log));
        self.diagnostics.add_load_messages(loaded.messages);
        bundled.unwrap_or_default()
    }
}
