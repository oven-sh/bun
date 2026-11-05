use super::module_list::collect_module_list;
use super::summary::{collect_entry_point_paths, collect_folder_paths, collect_source_texts};
use super::{BoundBuild, Build, FrontEndOutput, LoadedBuild};
use crate::builtins::{BuiltinId, table};
use crate::emit::FunctionsWithoutCode;
use crate::ir::generated::{
    BuiltinUsedAtStart, ModuleFlags, ModuleKind, NameClass, OpenedName, ReplaceableBuiltin,
    SourceStamp,
};
use crate::ir::parallel::map_each;
use crate::ir::{Id, ModuleId, StringId};
use crate::link::{
    self, LinkInput, LinkProject, LinkUnit, Linked, LinkedFunctions, ProgramModule,
    run_steps_beside,
};
use crate::load::runtime_roots::builtins_used_at_start;
use crate::load::{ProgramFile, ProjectId};
use crate::module_keys::{path_without_form, stamp_of_file};
use crate::modules::Shape;
use crate::statistics::{Stage, StatisticId, StepClock};
use bun_sema::erasure::PackedTypeRanges;
use bun_sema::program::FileId;
use rustc_hash::FxHashMap;

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
        bound: BoundBuild,
        mut units: Vec<LinkUnit>,
    ) -> Result<FrontEndOutput, Stage> {
        self.clock.start(Stage::LinkAndEmit);
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
        let input = LinkInput {
            units,
            projects,
            in_parallel: &in_parallel,
            beside: &beside,
        };
        let Linked {
            mut program,
            functions,
            modules,
            leftovers,
            ..
        } = match link::link(input) {
            Ok(linked) => linked,
            Err(errors) => {
                self.diagnostics.add_link_errors(errors, &self.limits);
                return Err(Stage::LinkAndEmit);
            }
        };
        let (mut with_names, mut with_value, mut faces) = (0, 0, 0);
        for &module in &modules {
            let (project, own) = match module {
                ProgramModule::File(_) | ProgramModule::Inner { .. } => module
                    .in_own_project()
                    .expect("the module has its text in a file"),
                ProgramModule::Face(_) => {
                    faces += 1;
                    continue;
                }
                _ => continue,
            };
            match bound.projects.get(project).graph.shape(own) {
                Shape::Names => with_names += 1,
                Shape::Value => with_value += 1,
                Shape::EsModule | Shape::AsToday => {}
            }
        }
        self.statistics
            .count(StatisticId::ModulesWithNames, with_names);
        self.statistics
            .count(StatisticId::ModulesWithValue, with_value);
        self.statistics.count(StatisticId::Faces, faces);
        let mut steps = StepClock::new(Stage::LinkAndEmit);
        let views = loaded.projects.as_ref().map(|_, project| project.view());
        let runs_tests = self.options.aot.runs_tests;
        let hands_code_over_beside_program = self.hands_code_over_beside_program;
        let (texts, (functions, added)) = run_steps_beside(
            &beside,
            &mut steps,
            [
                "source texts",
                "functions without code, what the link stage adds to the program",
            ],
            || collect_source_texts(&views, &modules, &types_in_function_texts, &in_parallel),
            || {
                let mut steps = StepClock::new(Stage::LinkAndEmit);
                run_steps_beside(
                    &beside,
                    &mut steps,
                    [
                        "functions without code",
                        "what the link stage adds to the program",
                    ],
                    || match hands_code_over_beside_program {
                        true => {
                            let without_code = FunctionsWithoutCode::new(functions, &in_parallel);
                            let none = LinkedFunctions::of_program_functions(Vec::new());
                            (none, Some(without_code))
                        }
                        false => (functions, None),
                    },
                    || {
                        let mut steps = StepClock::new(Stage::LinkAndEmit);
                        let application = loaded.project(ProjectId::Application);
                        let left_out = &bound.projects.application.left_out.files;
                        let entry_points = collect_entry_point_paths(application, left_out);
                        let folders = match entry_points.len() {
                            0 | 1 => Vec::new(),
                            _ => collect_folder_paths(application, left_out),
                        };
                        steps.end("link stage: paths of entry points and folders");
                        let replaced = &loaded.contents.replaced_builtins;
                        debug_assert!(replaced.is_sorted_by(|left, right| left < right));
                        program.replaceable_builtins = (replaced.iter())
                            .map(|&number| ReplaceableBuiltin {
                                member: BuiltinId::from_wire(number)
                                    .expect("the load lists members of the table"),
                                stays_locked: false,
                            })
                            .collect();
                        let main = table::find_name(b"main");
                        let holds_path =
                            main.and_then(|main| table::own_member(BuiltinId::Bun, main));
                        if let Some(member) = holds_path
                            && loaded.contents.any_file_may_become_main_module
                        {
                            let listed = &mut program.replaceable_builtins;
                            let place = listed
                                .binary_search_by_key(&member.to_wire(), |it| it.member.to_wire());
                            if let Err(place) = place {
                                let stays_locked = false;
                                listed.insert(
                                    place,
                                    ReplaceableBuiltin {
                                        member,
                                        stays_locked,
                                    },
                                );
                            }
                        }
                        let fixed = loaded.contents.fixed_builtins.list();
                        for member in fixed.into_iter().filter(|_| runs_tests) {
                            let listed = &mut program.replaceable_builtins;
                            let place = listed
                                .binary_search_by_key(&member.to_wire(), |it| it.member.to_wire());
                            if let Err(place) = place {
                                let stays_locked = true;
                                listed.insert(
                                    place,
                                    ReplaceableBuiltin {
                                        member,
                                        stays_locked,
                                    },
                                );
                            }
                        }
                        let used_at_start = builtins_used_at_start(self.options.aot).into_iter();
                        program.builtins_used_at_start = used_at_start
                            .map(|builtin| BuiltinUsedAtStart { builtin })
                            .collect();
                        let atoms = &application.loaded.files().atoms;
                        for &(holder, name) in &loaded.contents.names_added_to_builtins {
                            let name = program.strings.intern(atoms.bytes(name));
                            let class = program.strings.name_class(name);
                            if !matches!(
                                class,
                                NameClass::Index | NameClass::CanonicalNumericString
                            ) {
                                program.opened_names.push(OpenedName { holder, name });
                            }
                        }
                        if self.options.aot.runs_in_place {
                            const ASKED_TOGETHER: usize = 256;
                            let records = program.modules.iter().enumerate();
                            let of_program: Vec<(usize, StringId)> = records
                                .filter(|(_, module)| {
                                    !module.flags.contains(ModuleFlags::IS_LIBRARY)
                                        && (runs_tests
                                            || module.flags.contains(ModuleFlags::MAY_BE_EVICTED))
                                })
                                .map(|(index, module)| (index, module.path))
                                .collect();
                            let (strings, module_records) = (&program.strings, &program.modules);
                            let lots: Vec<&[(usize, StringId)]> =
                                of_program.chunks(ASKED_TOGETHER).collect();
                            let stamps =
                                map_each(lots, &in_parallel, &|lot: &[(usize, StringId)]| {
                                    let stamps = lot.iter().filter_map(|&(index, path)| {
                                        let path = strings.get(path);
                                        let stat_at =
                                            |path: &[u8]| match bun_core::strings::contains_char(
                                                path, 0,
                                            ) {
                                                true => None,
                                                false => {
                                                    bun_sys::stat(&bun_core::ZBox::from_bytes(path))
                                                        .ok()
                                                }
                                            };
                                        let is_data =
                                            module_records[index].kind == ModuleKind::Data;
                                        let file_of_form =
                                            path_without_form(path).filter(|_| is_data);
                                        let stat =
                                            stat_at(path).or_else(|| stat_at(file_of_form?))?;
                                        let stat = bun_sys::PosixStat::init(&stat);
                                        let stamp =
                                            stamp_of_file(stat.mtim.sec, stat.mtim.nsec, stat.size);
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
                        debug_assert_eq!(entry_points.len(), program.entries.len());
                        steps.end("link stage: built-ins that are replaced, names, stamps");
                        let listed_modules = (self.options.lists_modules)
                            .then(|| collect_module_list(&loaded, &bound, &modules, runs_tests));
                        steps.end("link stage: list of modules");
                        (entry_points, folders, listed_modules)
                    },
                )
            },
        );
        let (entry_points, folders, listed_modules) = added;
        let (functions, functions_without_code) = functions;
        self.leftovers.push(leftovers);
        let output = FrontEndOutput {
            #[cfg(not(test))]
            holds_source_paths: (loaded.projects.iter())
                .any(|(_, project)| project.sources.holds_source_paths()),
            modules: listed_modules,
            program,
            functions,
            functions_without_code,
            texts,
            entry_points,
            folders,
        };
        let sources = loaded.projects.map(|_, project| project.sources);
        self.leftovers.push(Box::new(sources));
        self.leftovers.push(Box::new(bound));
        steps.end("what the link stage hands on");
        Ok(output)
    }
}
