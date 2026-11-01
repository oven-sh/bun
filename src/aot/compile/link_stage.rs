use super::module_list::collect_module_list;
use super::replaced_exports::{ExportedVariables, collect_files_of_modules};
use super::summary::{collect_entry_point_paths, collect_folder_paths, collect_source_texts};
use super::{BoundBuild, BoundProject, Build, FrontEndOutput, LoadedBuild, ProgramPlace};
use crate::builtins::BuiltinId;
use crate::ir::generated::{
    ModuleFlags, ModuleKind, NameClass, OpenedName, ReplaceableBuiltin, SourceStamp,
};
use crate::ir::parallel::map_each;
use crate::ir::{Id, ModuleId, StringId};
use crate::link::{
    self, LinkError, LinkInput, LinkProject, LinkUnit, Linked, ProgramKeys, ProgramModule,
    ProgramVariableKey,
};
use crate::load::locked_builtin_defines::is_folded_in_test_runs;
use crate::load::sources::parsed_source;
use crate::load::{ProgramFile, ProjectId};
use crate::module_keys::stamp_of_file;
use crate::statistics::{Stage, StepClock};
use bun_sema::erasure::PackedTypeRanges;
use bun_sema::program::FileId;
use bun_sema::util::SharedSort;
use rustc_hash::FxHashMap;

// For whoever has to cut the program down: the paths and the name, not their numbers.
#[allow(clippy::disallowed_methods)] // a message for a person
pub(super) fn describe_link_error(loaded: &LoadedBuild<'_, '_>, error: &LinkError) -> Vec<u8> {
    let path = |file: ProgramFile| {
        let files = loaded.project(file.project).loaded.files();
        String::from_utf8_lossy(files.module(file.file).file_name()).into_owned()
    };
    let name_of = |name| String::from_utf8_lossy(loaded.atoms.bytes(name)).into_owned();
    let module_of = |module: ProgramModule| match module {
        ProgramModule::File(file) => path(file),
        ProgramModule::Inner { file, .. } => format!("a module inside {}", path(file)),
        ProgramModule::Face(file) => format!("the face of {}", path(file)),
        ProgramModule::Check(file) => format!("the check of {}", path(file)),
        ProgramModule::Runtime(module) => format!("{module:?}"),
        ProgramModule::External {
            importer,
            specifier,
            ..
        } => {
            format!("`{}`, imported by {}", name_of(specifier), path(importer))
        }
    };
    let both = |files: [ProgramFile; 2]| format!("{} and {}", path(files[0]), path(files[1]));
    let text = match *error {
        LinkError::UndefinedVariable { key, referenced_in } => {
            let variable = match key {
                ProgramVariableKey::Copy { module, name } => {
                    format!(
                        "what ES modules hold of `{}` of {}",
                        name_of(name),
                        module_of(module)
                    )
                }
                ProgramVariableKey::SyntheticExport { module, name } => {
                    format!("the export `{}` of {}", name_of(name), module_of(module))
                }
                ProgramVariableKey::MockOfRuntimeModule(module) => {
                    let module = module_of(ProgramModule::Runtime(module));
                    format!("the mock that stands in place of {module}")
                }
                ProgramVariableKey::Declared(declared) => match declared.key.home_file() {
                    Some(file) => {
                        let project = declared.project;
                        format!(
                            "{:?} of {}",
                            declared.key,
                            path(ProgramFile { project, file })
                        )
                    }
                    None => format!("{:?}", declared.key),
                },
            };
            format!(
                "UndefinedVariable: {variable}, reached from {}",
                path(referenced_in)
            )
        }
        LinkError::UndefinedFunction { key, referenced_in } => {
            let (project, file) = (key.project, key.key.home_file());
            let home = path(ProgramFile { project, file });
            format!(
                "UndefinedFunction: {:?} of {home}, reached from {}",
                key.key,
                path(referenced_in)
            )
        }
        LinkError::UndefinedLayout { key, referenced_in } => {
            format!(
                "UndefinedLayout: {:?}, reached from {}",
                key.key,
                path(referenced_in)
            )
        }
        LinkError::ConflictingDefinitions { key, files } => {
            format!("ConflictingDefinitions: {key:?} in {}", both(files))
        }
        LinkError::ConflictingRuntimeFunctions { function, files } => {
            format!(
                "ConflictingRuntimeFunctions: {function:?} in {}",
                both(files)
            )
        }
        LinkError::MissingUnit { file } => format!("MissingUnit: {}", path(file)),
        LinkError::MissingRecord { module, named_by } => match named_by {
            Some(named_by) => format!(
                "MissingRecord: {}, named by {}",
                module_of(module),
                module_of(named_by)
            ),
            None => format!("MissingRecord: {}", module_of(module)),
        },
        LinkError::TypeHashCollision { files } => format!("TypeHashCollision: {}", both(files)),
        LinkError::LimitExceeded { .. } => format!("{error:?}"),
    };
    text.into_bytes()
}

impl Build<'_> {
    pub(crate) fn take_unreached_runtime_files(&mut self) -> Vec<FileId> {
        core::mem::take(&mut self.unreached_runtime_files)
    }

    #[allow(
        clippy::needless_pass_by_value,
        reason = "link is the last stage that reads the loaded and the bound build"
    )]
    pub(super) fn link(
        &mut self,
        loaded: LoadedBuild<'_, '_>,
        bound: BoundBuild<'_>,
        mut units: Vec<LinkUnit>,
    ) -> Result<FrontEndOutput, Stage> {
        self.clock.start(Stage::LinkAndEmit);
        let mut steps = StepClock::new(Stage::LinkAndEmit, "stage");
        let types_in_function_texts: FxHashMap<ProgramFile, PackedTypeRanges> = (units.iter_mut())
            .filter_map(LinkUnit::take_types_in_function_text)
            .collect();
        let in_parallel = self.parallel_runner();
        let beside = self.beside_runner();
        let loaded_projects = loaded.projects.as_ref();
        let unreached_runtime_files = self.take_unreached_runtime_files();
        let projects = loaded_projects.map(|project, loaded_project| LinkProject {
            loaded: loaded_project.loaded,
            graph: &bound.projects.get(project).graph,
            sources: &loaded_project.sources,
            unreached_files: match project {
                ProjectId::Application => &bound.projects.application.left_out.files,
                ProjectId::Runtime => &unreached_runtime_files,
            },
        });
        let mut texts = None;
        let mut modules = None;
        let mut paths = None;
        let mut files_of_modules = Vec::new();
        let place = self.place;
        let (lists_modules, runs_tests) = (self.options.lists_modules, self.options.aot.runs_tests);
        let input = LinkInput {
            units,
            projects,
            limits: &self.limits,
            reports_type_mismatches: self.options.aot.reports_type_mismatches,
            has_programs_below: self.options.aot.imports_are_in_other_images,
            in_parallel: &in_parallel,
            beside: &beside,
        };
        steps.end("before the link");
        let linked = link::link_while(input, &mut |keys: &ProgramKeys| {
            texts = Some(collect_source_texts(
                &loaded,
                &keys.modules,
                &types_in_function_texts,
                &in_parallel,
            ));
            let application = loaded.project(ProjectId::Application);
            let entry_points = collect_entry_point_paths(application);
            // Nothing loads the one entry point of a build by a name.
            let folders = match (entry_points.len(), place) {
                (0 | 1, ProgramPlace::Only) => Vec::new(),
                _ => collect_folder_paths(application),
            };
            paths = Some((entry_points, folders));
            if runs_tests {
                files_of_modules = collect_files_of_modules(&loaded, &keys.modules);
            }
            if lists_modules {
                modules = Some(collect_module_list(
                    &loaded,
                    &bound,
                    &keys.modules,
                    runs_tests,
                ));
            }
        });
        let Linked {
            mut program,
            body_remap,
            names,
            keys: _,
            writes_preload,
            counters,
            leftovers,
        } = match linked {
            Ok(linked) => linked,
            Err(errors) => {
                for error in &errors {
                    if let LinkError::LimitExceeded { limit, .. } = *error {
                        self.statistics.gave_up(limit, None);
                    }
                }
                let describe = |error: &LinkError| describe_link_error(&loaded, error);
                self.diagnostics
                    .add_link_errors(errors, &self.limits, &describe);
                return Err(Stage::LinkAndEmit);
            }
        };
        steps.end("link_while, all of it");
        let application = loaded.project(ProjectId::Application);
        let replaced = self.options.load.replaced_builtins.iter();
        let mut replaced: Vec<BuiltinId> = replaced
            .filter_map(|&number| BuiltinId::from_wire(number))
            .collect();
        // What is left of what the files spell was never locked for the front end.
        if self.options.load.runs_tests {
            let files = application.loaded.files();
            let sources = files.compiled_files().iter();
            let sources = sources.filter_map(|&file| parsed_source(files, file));
            let sources = sources.filter(|it| !it.finds_builtins_read_only());
            replaced.extend(sources.flat_map(|source| source.builtins.replaced_members()));
        }
        replaced.retain(|&member| !is_folded_in_test_runs(member));
        replaced.shared_sort_unstable();
        replaced.dedup();
        let numbers = replaced.iter().map(|&member| member as u32);
        self.replaced_builtins.builtins.extend(numbers);
        program.replaceable_builtins = (replaced.into_iter())
            .map(|member| ReplaceableBuiltin { member })
            .collect();
        let found_before = self.options.load.opened_names.iter();
        let mut opened: Vec<(BuiltinId, &[u8])> = found_before
            .filter_map(|name| Some((BuiltinId::from_wire(name.holder)?, &name.name[..])))
            .collect();
        // The front end asks nothing of these names, so what the files spell goes straight to the engine.
        let files = application.loaded.files();
        let sources = files.compiled_files().iter();
        let sources = sources.filter_map(|&file| parsed_source(files, file));
        let spelled = sources.flat_map(|source| match source.finds_builtins_read_only() {
            true => source.builtins.names_added_in_executable().iter(),
            false => source.builtins.names_added().iter(),
        });
        opened.extend(spelled.map(|&(holder, name)| (holder, files.atoms.bytes(name))));
        opened.shared_sort_unstable();
        opened.dedup();
        for (holder, name) in opened {
            (self.replaced_builtins.names_added_to_builtins).push((holder as u32, name.to_vec()));
            let name = program.strings.intern(name);
            let class = program.strings.name_class(name);
            if !matches!(class, NameClass::Index | NameClass::CanonicalNumericString) {
                program.opened_names.push(OpenedName { holder, name });
            }
        }
        // A test may write a file of the program anew before anything has loaded it, and `bun test` reads what is there by then.
        steps.end("built-ins replaced and names added");
        if self.options.aot.runs_in_place {
            // The system is asked about each file: thousands of calls, which wait for nothing but one another.
            const ASKED_TOGETHER: usize = 256;
            let modules = program.modules.iter().enumerate();
            let may_be_evicted: Vec<(usize, StringId)> = modules
                .filter(|(_, module)| module.flags.contains(ModuleFlags::MAY_BE_EVICTED))
                .map(|(index, module)| (index, module.path))
                .collect();
            let strings = &program.strings;
            let lots: Vec<&[(usize, StringId)]> = may_be_evicted.chunks(ASKED_TOGETHER).collect();
            let stamps = map_each(lots, &in_parallel, &|lot: &[(usize, StringId)]| {
                let stamps = lot.iter().filter_map(|&(index, path)| {
                    let path = bun_core::ZBox::from_bytes(strings.get(path));
                    let stat = bun_sys::PosixStat::init(&bun_sys::stat(&path).ok()?);
                    let stamp = stamp_of_file(stat.mtim.sec, stat.mtim.nsec, stat.size);
                    Some(SourceStamp {
                        module: ModuleId::new(index),
                        low: stamp as u32,
                        high: (stamp >> 32) as u32,
                    })
                });
                stamps.collect::<Vec<SourceStamp>>()
            });
            program.source_stamps.extend(stamps.into_iter().flatten());
        }
        steps.end("a stamp for each module's file");
        self.statistics.add_counters(application.view(), counters);
        let (entry_points, folders) = paths.expect("link has called it");
        debug_assert_eq!(entry_points.len(), program.entries.len());
        self.leftovers.push(leftovers);
        let names_way = ModuleFlags::NAMES_WAY_TO_MODULE_OBJECTS;
        let application_graph = &bound.projects.application.graph;
        let output = FrontEndOutput {
            names_way_to_module_objects: (program.modules.iter())
                .any(|module| module.flags.contains(names_way)),
            has_commonjs_entry_point: (program.entries.iter())
                .any(|entry| program.modules[entry.module.index()].kind == ModuleKind::CommonJs),
            ways_not_followed_out_of_sight: application_graph.ways_not_followed_out_of_sight(),
            ways_followed_for_their_names: application_graph.ways_followed_for_their_names(),
            lets_process_out_of_sight: application_graph.lets_process_out_of_sight(),
            is_ready_for_loader_functions: application_graph.is_ready_for_loader_functions(),
            exported_variables: ExportedVariables::collect(&program, &files_of_modules),
            writes_preload,
            holds_source_paths: (loaded.projects.iter())
                .any(|(_, project)| project.sources.holds_source_paths()),
            held_library_code: core::mem::take(&mut self.held_library_code),
            program,
            body_remap,
            names,
            texts: texts.expect("link has called it"),
            entry_points,
            folders,
            modules,
        };
        // Freed beside the engine's run.
        let sources = loaded.projects.map(|_, project| project.sources);
        self.leftovers.push(Box::new(sources));
        let bound = bound.projects.map(|_, project| {
            let BoundProject {
                graph,
                left_out,
                known_helpers,
                deferred_data: _,
                builtin_types,
            } = project;
            (graph, left_out, known_helpers, builtin_types)
        });
        self.leftovers.push(Box::new(bound));
        steps.end("the output");
        Ok(output)
    }
}
