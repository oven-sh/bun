use super::{EntryPointPaths, FolderPaths, FollowedName, LoadedProject};
use crate::diagnostics::ProgramView;
use crate::ir::{InParallel, collect_from_each, for_each_mut};
use crate::link::ProgramModule;
use crate::load::module_paths::with_separators_of_host;
use crate::load::sources::SourceKind;
use crate::load::{
    EntryPointKind, PerProject, ProgramFile, ProjectId, Sources, file_size, is_host_path,
    read_file_bytes,
};
use crate::modules::{ModuleGraph, ModuleRef, SiteAnswer};
use crate::report::{FunctionSources, ModuleOrigin, ModuleSource, SourceTexts};
use crate::statistics::{Stage, StepClock};
use bun_sema::check::aot::FileOrigin;
use bun_sema::erasure::PackedTypeRanges;
use bun_sema::hir::ExprKind;
use bun_sema::import_sites::{ImportSiteKind, ImportSpecifier, ResolvedFrom, is_load_found_late};
use bun_sema::program::{FileId, Files};
use bun_sema::util::SharedSort;
use bun_sema_driver::host::to_native;
use rustc_hash::FxHashMap;
use std::ops::Range;
use std::sync::Arc;

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
            let public_path = sources.public_path(it.file).to_vec();
            let file_name = files.module(it.file).file_name();
            EntryPointPaths {
                source_path: match is_host_path(file_name) {
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

pub(super) fn collect_program_file_paths(
    files: &Files<'_>,
    sources: &Sources,
) -> Vec<(FileId, EntryPointPaths)> {
    let compiled = files.compiled_files().iter();
    compiled
        .filter(|&&file| matches!(sources.kind(file), SourceKind::Program | SourceKind::Data))
        .filter(|&&file| !is_host_path(files.module(file).file_name()))
        .map(|&file| {
            let paths = EntryPointPaths {
                public_path: sources.public_path(file).to_vec(),
                source_path: with_separators_of_host(
                    to_native(files.module(file).file_name()),
                    cfg!(windows),
                ),
            };
            (file, paths)
        })
        .collect()
}

fn list_folders(path_of_file: &[u8]) -> Vec<&[u8]> {
    let mut folders: Vec<&[u8]> = Vec::new();
    for part in bun_core::strings::split(path_of_file, b"/") {
        match part {
            b"" if folders.is_empty() => folders.push(part),
            b"" | b"." => {}
            b".." if folders.len() > 1 => {
                folders.pop();
            }
            _ => folders.push(part),
        }
    }
    folders.pop();
    folders
}

fn find_public_folder(looked_from: &[u8], found: &[u8], found_public: &[u8]) -> Option<Vec<u8>> {
    let (from, found) = (list_folders(looked_from), list_folders(found));
    let mut public = list_folders(found_public);
    let shared = (from.iter().zip(&found))
        .take_while(|(a, b)| a == b)
        .count();
    for folder in found[shared..].iter().rev() {
        if public.pop() != Some(*folder) {
            return None;
        }
    }
    public.extend_from_slice(&from[shared..]);
    Some(public.join(&b'/'))
}

fn find_folder_looked_from(
    files: &Files<'_>,
    sources: &Sources,
    file: FileId,
    site: ImportSiteKind,
    found: FileId,
) -> Option<Vec<u8>> {
    let analysis = files.analysis(file);
    let index = analysis
        .import_sites
        .iter()
        .position(|it| it.kind == site)?;
    let own_name = files.module(file).file_name();
    let looked_from = match analysis.path_to_resolve_from(index) {
        None => own_name.to_vec(),
        Some(ResolvedFrom::File(path)) => files.atoms.bytes(path).to_vec(),
        Some(ResolvedFrom::PathFromOwnFolder(path)) => {
            let path = files.atoms.bytes(path);
            let end = bun_core::strings::last_index_of_char(own_name, b'/').unwrap_or(0);
            match path {
                b"" => own_name[..end].to_vec(),
                _ if path.ends_with(b"/") => [&own_name[..end], b"/", path, b"noop.js"].concat(),
                _ => [&own_name[..end], b"/", path].concat(),
            }
        }
    };
    let from_file = |known: FileId| {
        let name = files.module(known).file_name();
        find_public_folder(&looked_from, name, sources.public_path(known))
    };
    from_file(file).or_else(|| from_file(found))
}

pub(super) fn collect_names_followed(
    files: &Files<'_>,
    sources: &Sources,
    graph: &ModuleGraph,
    left_out: &[FileId],
    in_parallel: InParallel<'_>,
) -> Vec<FollowedName> {
    let collect = |file: FileId, names: &mut Vec<FollowedName>| {
        let mut write_down = |site: ImportSiteKind, name: &[u8], target: FileId| {
            let is_required = !matches!(
                site,
                ImportSiteKind::ImportCall(_) | ImportSiteKind::ImportMetaResolve(_)
            );
            if left_out.binary_search(&target).is_ok() {
                return;
            }
            let Some(folder) = find_folder_looked_from(files, sources, file, site, target) else {
                return;
            };
            let found = || Some(sources.public_path(target).to_vec());
            names.push(FollowedName {
                folder_and_name_as_written: [&folder[..], b"//", name].concat(),
                public_path_for_require: is_required.then(found).flatten(),
                public_path_for_import: (!is_required).then(found).flatten(),
            });
        };
        for (spelled, site) in graph.names_left_to_loader(file) {
            if let ModuleRef::File(target) = spelled.module {
                write_down(site, files.atoms.bytes(spelled.spelling), target);
            }
        }
        let hir = files.hir(file);
        let decisions = &files.analysis(file).decisions;
        for site in files.analysis(file).import_sites {
            let names_parent = match site.kind {
                ImportSiteKind::RequireResolve(_) => false,
                ImportSiteKind::Require(call)
                    if is_load_found_late(hir, files.bound(file), decisions, call) =>
                {
                    false
                }
                ImportSiteKind::ImportMetaResolve(call) => {
                    !matches!(hir[call].kind, ExprKind::Call(call) if hir[call].args.len() == 1)
                }
                _ => continue,
            };
            if !names_parent
                && let ImportSpecifier::Constant(written) = site.specifier
                && let Some(SiteAnswer::Module(ModuleRef::File(target))) =
                    graph.find_site_answer(file, site.kind)
            {
                write_down(site.kind, files.atoms.bytes(written), target);
            }
        }
    };
    let mut names = collect_from_each(files.compiled_files(), in_parallel, &collect);
    names.shared_sort_unstable();
    names.dedup_by(|later, earlier| {
        let is_same = later.folder_and_name_as_written == earlier.folder_and_name_as_written;
        if is_same {
            let for_require = earlier.public_path_for_require.take();
            earlier.public_path_for_require =
                for_require.or_else(|| later.public_path_for_require.take());
            let for_import = earlier.public_path_for_import.take();
            earlier.public_path_for_import =
                for_import.or_else(|| later.public_path_for_import.take());
        }
        is_same
    });
    names
}

pub(super) fn collect_folder_paths(
    project: &LoadedProject<'_, '_>,
    left_out: &[FileId],
) -> Vec<FolderPaths> {
    let (files, sources) = (project.loaded.files(), &project.sources);
    let compiled = files.compiled_files().iter();
    let mut folders: Vec<(&[u8], &[u8])> = compiled
        .filter(|file| left_out.binary_search(file).is_err())
        .map(|&file| {
            (
                folder_of(sources.public_path(file)),
                folder_of(to_native(files.module(file).file_name())),
            )
        })
        .collect();
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
    projects: &PerProject<ProgramView<'_, '_>>,
    modules: &[ProgramModule],
    erased_ranges_by_file: &FxHashMap<ProgramFile, PackedTypeRanges>,
    runs_tests: bool,
    in_parallel: InParallel<'_>,
) -> SourceTexts {
    let mut steps = StepClock::new(Stage::LinkAndEmit);
    let mut slots: Vec<Slot> = modules
        .iter()
        .map(|&module| Slot {
            module,
            source: None,
            holds_function_source: false,
        })
        .collect();
    let holds_function_sources =
        runs_tests && has_many_function_sources(projects, erased_ranges_by_file);
    for_each_mut(&mut slots, in_parallel, &|slot| {
        slot.source = create_module_source(
            projects,
            slot.module,
            erased_ranges_by_file,
            holds_function_sources,
            &mut slot.holds_function_source,
        );
    });
    let function_sources = hold_function_sources(projects, &mut slots, in_parallel);
    let texts = SourceTexts::new(slots.into_iter().map(|slot| slot.source).collect());
    let texts = texts.with_function_sources(function_sources);
    steps.end_with(|| format!("source texts {} MB", texts.size_of_texts() >> 20));
    texts
}

struct Slot {
    module: ProgramModule,
    source: Option<ModuleSource>,
    /// The text is on disk, and the function source is held apart from it.
    holds_function_source: bool,
}

/// A build with fewer keeps them all.
fn has_many_function_sources(
    projects: &PerProject<ProgramView<'_, '_>>,
    erased_ranges_by_file: &FxHashMap<ProgramFile, PackedTypeRanges>,
) -> bool {
    const FEW: usize = 64 << 20;
    let sizes = erased_ranges_by_file.keys();
    let sizes = sizes.map(|&file| text_of(projects, file).len());
    sizes.sum::<usize>() > FEW
}

fn text_of<'p>(projects: &PerProject<ProgramView<'p, '_>>, file: ProgramFile) -> &'p [u8] {
    let files = projects.get(file.project).files();
    &files.module(file.file).hir.text[..]
}

fn hold_function_sources(
    projects: &PerProject<ProgramView<'_, '_>>,
    slots: &mut [Slot],
    in_parallel: InParallel<'_>,
) -> Arc<FunctionSources> {
    let mut parts: Vec<Range<usize>> = Vec::with_capacity(slots.len());
    let mut end = 0;
    for slot in &*slots {
        let source = slot.source.as_ref().filter(|_| slot.holds_function_source);
        let start = end;
        end += source.map_or(0, ModuleSource::function_source_len);
        parts.push(start..end);
    }
    let mut bytes = vec![0; end];
    let mut rest = &mut bytes[..];
    let mut places: Vec<(&mut [u8], &Slot)> = Vec::new();
    for (slot, part) in slots.iter().zip(&parts) {
        let (place, behind) = rest.split_at_mut(part.len());
        places.push((place, slot));
        rest = behind;
    }
    for_each_mut(&mut places, in_parallel, &|(place, slot)| {
        if let (ProgramModule::File(file), Some(source), true) =
            (slot.module, &slot.source, slot.holds_function_source)
        {
            source.remove_types_from(text_of(projects, file), place);
        }
    });
    let sources = Arc::new(FunctionSources::new(bytes.into_boxed_slice()));
    for (slot, part) in slots.iter_mut().zip(parts) {
        if slot.holds_function_source {
            let source = slot.source.take();
            slot.source = source.map(|source| source.with_function_source_in(&sources, part));
        }
    }
    sources
}

fn create_module_source(
    projects: &PerProject<ProgramView<'_, '_>>,
    module: ProgramModule,
    erased_ranges_by_file: &FxHashMap<ProgramFile, PackedTypeRanges>,
    holds_function_sources: bool,
    holds_function_source: &mut bool,
) -> Option<ModuleSource> {
    let program_file = match module {
        ProgramModule::File(file) => file,
        _ => return None,
    };
    let ProgramFile { project, file } = program_file;
    let view = *projects.get(project);
    let files = view.files();
    if !files.is_compiled(file) {
        return None;
    }
    let text = &files.module(file).hir.text[..];
    let types = erased_ranges_by_file.get(&program_file).cloned();
    let origin = find_module_origin(view, program_file);
    let path = view.sources.diagnostic_path(file);
    let path_on_disk = files.module(file).file_name();
    // Whoever wants a text that is held apart from its function source compares it with what is on disk then.
    let is_on_disk = project == ProjectId::Application
        && match types {
            None => read_file_bytes(path_on_disk).is_some_and(|on_disk| on_disk == text),
            Some(_) => holds_function_sources && file_size(path_on_disk) == Some(text.len() as u64),
        };
    *holds_function_source = is_on_disk && types.is_some();
    let source = match is_on_disk {
        true => ModuleSource::new_on_disk(path, path_on_disk, text),
        false => ModuleSource::new(path, text),
    };
    Some(source.with_function_source(types).with_origin(origin))
}

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
