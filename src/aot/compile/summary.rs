use super::{EntryPointPaths, FolderPaths, LoadedProject};
use crate::diagnostics::ProgramView;
use crate::ir::{InParallel, for_each_mut};
use crate::link::ProgramModule;
use crate::load::module_paths::with_separators_of_host;
use crate::load::sources::SourceKind;
use crate::load::{
    EntryPointKind, PerProject, ProgramFile, ProjectId, Sources, is_host_path, read_file_bytes,
};
use crate::report::{ModuleOrigin, ModuleSource, SourceTexts};
use crate::statistics::{Stage, StepClock};
use bun_sema::check::aot::FileOrigin;
use bun_sema::erasure::PackedTypeRanges;
use bun_sema::program::{FileId, Files};
use bun_sema::util::SharedSort;
use bun_sema_driver::host::to_native;
use rustc_hash::FxHashMap;

/// `left_out`: `LeftOutCode::files`. An entry point that the load has found for a Worker which nothing starts is among them.
pub(super) fn collect_entry_point_paths(
    project: &LoadedProject<'_, '_>,
    left_out: &[FileId],
) -> Vec<EntryPointPaths> {
    let (files, sources) = (project.loaded.files(), &project.sources);
    let entry_points = sources.entry_points().iter();
    entry_points
        .filter(|it| {
            matches!(
                it.kind,
                EntryPointKind::Main
                    | EntryPointKind::Additional
                    | EntryPointKind::LoadedByTestRunner
            ) && left_out.binary_search(&it.file).is_err()
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

pub(super) fn collect_folder_paths(
    project: &LoadedProject<'_, '_>,
    left_out: &[FileId],
) -> Vec<FolderPaths> {
    let (files, sources) = (project.loaded.files(), &project.sources);
    let compiled = files.compiled_files().iter();
    // In the order of the fields of `FolderPaths`.
    let mut folders: Vec<(&[u8], &[u8])> = compiled
        .filter(|file| left_out.binary_search(file).is_err())
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

/// `modules`: `Linked::modules`, in the order of `ModuleId`.
pub(super) fn collect_source_texts(
    projects: &PerProject<ProgramView<'_, '_>>,
    modules: &[ProgramModule],
    types_in_function_texts: &FxHashMap<ProgramFile, PackedTypeRanges>,
    in_parallel: InParallel<'_>,
) -> SourceTexts {
    let mut steps = StepClock::new(Stage::LinkAndEmit);
    let mut slots: Vec<(ProgramModule, Option<ModuleSource>)> =
        modules.iter().map(|&module| (module, None)).collect();
    for_each_mut(&mut slots, in_parallel, &|(module, source)| {
        *source = create_module_source(projects, *module, types_in_function_texts);
    });
    let texts = SourceTexts::new(slots.into_iter().map(|(_, source)| source).collect());
    steps.end_with(|| format!("source texts {} MB", texts.size_of_texts() >> 20));
    texts
}

fn create_module_source(
    projects: &PerProject<ProgramView<'_, '_>>,
    module: ProgramModule,
    types_in_function_texts: &FxHashMap<ProgramFile, PackedTypeRanges>,
) -> Option<ModuleSource> {
    let program_file = match module {
        ProgramModule::File(file) => file,
        // Every position in the text of a file names the record of the file.
        _ => return None,
    };
    let ProgramFile { project, file } = program_file;
    let view = *projects.get(project);
    let files = view.files();
    if !files.is_compiled(file) {
        return None;
    }
    let text = &files.module(file).hir.text[..];
    let types = types_in_function_texts.get(&program_file).cloned();
    let origin = find_module_origin(view, program_file);
    let path = view.sources.diagnostic_path(file);
    // The engine asks for the text of every function. A plugin, a text of the command line or Bun's own archive gives a text that no file holds.
    let path_on_disk = files.module(file).file_name();
    let is_on_disk = types.is_none()
        && project == ProjectId::Application
        && read_file_bytes(path_on_disk).is_some_and(|on_disk| on_disk == text);
    let source = match is_on_disk {
        true => ModuleSource::new_on_disk(path, path_on_disk, text.len()),
        false => ModuleSource::new(path, text),
    };
    Some(source.with_function_text(types).with_origin(origin))
}

/// `view`: of the project of `file`.
fn find_module_origin(view: ProgramView<'_, '_>, file: ProgramFile) -> ModuleOrigin {
    let file = match file.project {
        ProjectId::Application => file.file,
        ProjectId::Runtime => return ModuleOrigin::Runtime,
    };
    match view.origin(file) {
        FileOrigin::DependencySource | FileOrigin::DependencyJavaScript => ModuleOrigin::Dependency,
        FileOrigin::Declarations => match view.files().module(file).is_from_external_library {
            true => ModuleOrigin::Dependency,
            false => ModuleOrigin::Program,
        },
        FileOrigin::Runtime => ModuleOrigin::Runtime,
        FileOrigin::NoFile
        | FileOrigin::ProgramSource
        | FileOrigin::TestedSource
        | FileOrigin::ProgramJavaScript
        | FileOrigin::EvaluatedText => ModuleOrigin::Program,
    }
}
