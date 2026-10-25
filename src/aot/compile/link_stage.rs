use super::module_list::collect_module_list;
use super::summary::{collect_entry_point_paths, collect_folder_paths, collect_source_texts};
use super::{BoundBuild, Build, FrontEndOutput, LoadedBuild, ProgramPlace};
use crate::link::{
    self, LinkError, LinkInput, LinkProject, LinkUnit, Linked, ProgramKeys, ProgramModule,
    ProgramVariableKey,
};
use crate::load::{ProgramFile, ProjectId};
use crate::statistics::Stage;
use bun_sema::program::FileId;

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
        units: Vec<LinkUnit>,
    ) -> Result<FrontEndOutput, Stage> {
        self.clock.start(Stage::LinkAndEmit);
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
        let (lists_modules, runs_tests) = (self.options.lists_modules, self.options.aot.runs_tests);
        let input = LinkInput {
            units,
            projects,
            limits: &self.limits,
            in_parallel: &in_parallel,
            beside: &beside,
        };
        let linked = link::link_while(input, &mut |keys: &ProgramKeys| {
            texts = Some(collect_source_texts(&loaded, &keys.modules, &in_parallel));
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
            program,
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
        let application = loaded.project(ProjectId::Application);
        self.statistics.add_counters(application.view(), counters);
        let entry_points = collect_entry_point_paths(application);
        debug_assert_eq!(entry_points.len(), program.entries.len());
        // Nothing loads the one entry point of a build by a name.
        let folders = match (entry_points.len(), self.place) {
            (0 | 1, ProgramPlace::Only) => Vec::new(),
            _ => collect_folder_paths(application),
        };
        self.leftovers.push(leftovers);
        Ok(FrontEndOutput {
            writes_preload,
            program,
            body_remap,
            names,
            texts: texts.expect("link has called it"),
            entry_points,
            folders,
            modules,
        })
    }
}
