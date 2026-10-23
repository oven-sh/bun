use super::{EntryPointPaths, FolderPaths, LoadedBuild, LoadedProject};
use crate::ir::{InParallel, for_each_mut};
use crate::link::ProgramModule;
use crate::load::{EntryPointKind, PerProject, ProgramFile, Sources};
use crate::report::{ModuleSource, SourceTexts};
use bun_sema::program::Files;
use bun_sema::util::SharedSort;
use bun_sema_driver::host::to_native;

pub(super) fn collect_entry_point_paths(project: &LoadedProject<'_, '_>) -> Vec<EntryPointPaths> {
    let files = project.loaded.files();
    let sources = &project.sources;
    sources
        .entry_points()
        .iter()
        .filter(|entry_point| {
            matches!(
                entry_point.kind,
                EntryPointKind::Main | EntryPointKind::Additional
            )
        })
        .map(|entry_point| EntryPointPaths {
            public_path: sources.module_paths(entry_point.file).public_path.to_vec(),
            source_path: to_native(files.module(entry_point.file).file_name()).to_vec(),
        })
        .collect()
}

fn folder_of(path: &[u8], is_separator: impl Fn(u8) -> bool) -> &[u8] {
    &path[..path
        .iter()
        .rposition(|&byte| is_separator(byte))
        .unwrap_or(0)]
}

pub(super) fn collect_folder_paths(project: &LoadedProject<'_, '_>) -> Vec<FolderPaths> {
    let files = project.loaded.files();
    let sources = &project.sources;
    let mut folders: Vec<FolderPaths> = files
        .compiled_files()
        .iter()
        .map(|&file| FolderPaths {
            public_path: folder_of(sources.module_paths(file).public_path, |byte| byte == b'/')
                .to_vec(),
            source_path: folder_of(
                to_native(files.module(file).file_name()),
                bun_paths::is_sep_native,
            )
            .to_vec(),
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
