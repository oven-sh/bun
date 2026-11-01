use super::{EntryPointPaths, FolderPaths, LoadedBuild, LoadedProject};
use crate::ir::{InParallel, for_each_mut};
use crate::link::ProgramModule;
use crate::load::module_paths::with_separators_of_host;
use crate::load::sources::SourceKind;
use crate::load::{EntryPointKind, PerProject, ProgramFile, Sources, is_host_path};
use crate::report::{ModuleSource, SourceTexts};
use bun_sema::erasure::PackedTypeRanges;
use bun_sema::program::Files;
use bun_sema::util::SharedSort;
use bun_sema_driver::host::to_native;
use rustc_hash::FxHashMap;

pub(super) fn collect_entry_point_paths(project: &LoadedProject<'_, '_>) -> Vec<EntryPointPaths> {
    let (files, sources) = (project.loaded.files(), &project.sources);
    let entry_points = sources.entry_points().iter();
    entry_points
        .filter(|it| {
            matches!(
                it.kind,
                EntryPointKind::Main
                    | EntryPointKind::Additional
                    | EntryPointKind::LoadedByTestRunner
            )
        })
        .map(|it| {
            let public_path = sources.module_paths(it.file).public_path.to_vec();
            let file_name = files.module(it.file).file_name();
            EntryPointPaths {
                source_path: match is_host_path(file_name) {
                    // A text that the program holds is nowhere on the disk.
                    true => public_path.clone(),
                    false => with_separators_of_host(to_native(file_name), cfg!(windows)),
                },
                public_path,
            }
        })
        .collect()
}

fn folder_of(path: &[u8]) -> &[u8] {
    let end = path
        .iter()
        .rposition(|&byte| bun_paths::is_sep_native(byte));
    &path[..end.unwrap_or(0)]
}

/// The files with code of the program, with the separators of the host: the resolver answers with those.
pub(super) fn collect_program_file_paths(
    files: &Files<'_>,
    sources: &Sources,
) -> Vec<EntryPointPaths> {
    let compiled = files.compiled_files().iter();
    compiled
        .filter(|&&file| sources.kind(file) == SourceKind::Program)
        .filter(|&&file| !is_host_path(files.module(file).file_name()))
        .map(|&file| EntryPointPaths {
            public_path: sources.module_paths(file).public_path.to_vec(),
            source_path: with_separators_of_host(
                to_native(files.module(file).file_name()),
                cfg!(windows),
            ),
        })
        .collect()
}

pub(super) fn collect_folder_paths(project: &LoadedProject<'_, '_>) -> Vec<FolderPaths> {
    let (files, sources) = (project.loaded.files(), &project.sources);
    let compiled = files.compiled_files().iter();
    // In the order of the fields of `FolderPaths`.
    let mut folders: Vec<(&[u8], &[u8])> = compiled
        .map(|&file| {
            (
                folder_of(sources.module_paths(file).public_path),
                folder_of(to_native(files.module(file).file_name())),
            )
        })
        .collect();
    // Files of one folder mostly follow each other.
    folders.dedup();
    folders.shared_sort_unstable();
    folders.dedup();
    let folders = folders.into_iter();
    folders
        .map(|(public_path, source_path)| FolderPaths {
            public_path: public_path.to_vec(),
            source_path: source_path.to_vec(),
        })
        .collect()
}

pub(super) fn collect_source_texts(
    loaded: &LoadedBuild<'_, '_>,
    modules: &[ProgramModule],
    types_in_function_texts: &FxHashMap<ProgramFile, PackedTypeRanges>,
    in_parallel: InParallel<'_>,
) -> SourceTexts {
    let projects = loaded.projects.as_ref();
    let projects = projects.map(|_, project| (project.loaded.files(), &project.sources));
    let mut slots: Vec<(ProgramModule, Option<ModuleSource>)> =
        modules.iter().map(|&module| (module, None)).collect();
    for_each_mut(&mut slots, in_parallel, &|(module, source)| {
        *source = create_module_source(&projects, *module, types_in_function_texts);
    });
    SourceTexts::new(slots.into_iter().map(|(_, source)| source).collect())
}

fn create_module_source(
    projects: &PerProject<(&Files<'_>, &Sources)>,
    module: ProgramModule,
    types_in_function_texts: &FxHashMap<ProgramFile, PackedTypeRanges>,
) -> Option<ModuleSource> {
    let program_file = match module {
        ProgramModule::File(file) => file,
        // Every position in the text of a file names the record of the file.
        _ => return None,
    };
    let ProgramFile { project, file } = program_file;
    let &(files, sources) = projects.get(project);
    if !files.is_compiled(file) {
        return None;
    }
    let text = &files.module(file).hir.text[..];
    let types = types_in_function_texts.get(&program_file).cloned();
    Some(ModuleSource::new(sources.diagnostic_path(file), text).with_function_text(types))
}
