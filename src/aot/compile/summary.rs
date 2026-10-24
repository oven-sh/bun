use super::{EntryPointPaths, FolderPaths, LoadedBuild, LoadedProject};
use crate::ir::{InParallel, for_each_mut};
use crate::link::ProgramModule;
use crate::load::module_paths::with_separators_of_host;
use crate::load::{EntryPointKind, PerProject, ProgramFile, Sources};
use crate::report::{ModuleSource, SourceTexts};
use bun_sema::program::Files;
use bun_sema::util::SharedSort;
use bun_sema_driver::host::to_native;

pub(super) fn collect_entry_point_paths(project: &LoadedProject<'_, '_>) -> Vec<EntryPointPaths> {
    let (files, sources) = (project.loaded.files(), &project.sources);
    let entry_points = sources.entry_points().iter();
    entry_points
        .filter(|it| matches!(it.kind, EntryPointKind::Main | EntryPointKind::Additional))
        .map(|it| EntryPointPaths {
            public_path: sources.module_paths(it.file).public_path.to_vec(),
            source_path: with_separators_of_host(
                to_native(files.module(it.file).file_name()),
                cfg!(windows),
            ),
        })
        .collect()
}

fn folder_of(path: &[u8]) -> Vec<u8> {
    let end = path
        .iter()
        .rposition(|&byte| bun_paths::is_sep_native(byte));
    path[..end.unwrap_or(0)].to_vec()
}

pub(super) fn collect_folder_paths(project: &LoadedProject<'_, '_>) -> Vec<FolderPaths> {
    let (files, sources) = (project.loaded.files(), &project.sources);
    let compiled = files.compiled_files().iter();
    let mut folders: Vec<FolderPaths> = compiled
        .map(|&file| FolderPaths {
            public_path: folder_of(sources.module_paths(file).public_path),
            source_path: folder_of(to_native(files.module(file).file_name())),
        })
        .collect();
    folders.shared_sort_unstable();
    folders.dedup();
    folders
}

pub(super) fn collect_source_texts(
    loaded: &LoadedBuild<'_, '_>,
    modules: &[ProgramModule],
    in_parallel: InParallel<'_>,
) -> SourceTexts {
    let projects = loaded.projects.as_ref();
    let projects = projects.map(|_, project| (project.loaded.files(), &project.sources));
    let mut slots: Vec<(ProgramModule, Option<ModuleSource>)> =
        modules.iter().map(|&module| (module, None)).collect();
    for_each_mut(&mut slots, in_parallel, &|(module, source)| {
        *source = create_module_source(&projects, *module);
    });
    SourceTexts::new(slots.into_iter().map(|(_, source)| source).collect())
}

fn create_module_source(
    projects: &PerProject<(&Files<'_>, &Sources)>,
    module: ProgramModule,
) -> Option<ModuleSource> {
    let ProgramFile { project, file } = match module {
        ProgramModule::File(file) => file,
        // Every position in the text of a file names the record of the file.
        _ => return None,
    };
    let &(files, sources) = projects.get(project);
    if !files.is_compiled(file) {
        return None;
    }
    let text = &files.module(file).hir.text[..];
    Some(ModuleSource::new(sources.diagnostic_path(file), text))
}
