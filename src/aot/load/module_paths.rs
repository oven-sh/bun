use bun_builtin_sources::Manifest;
use bun_core::strings;
use bun_paths::resolve_path::{buf_or_spill, relative_platform_buf};
use bun_paths::{MAX_PATH_BYTES, is_absolute, path_buffer_pool, platform};
use bun_sema::program::{FileId, FileRole, Files, HostLoader};
use bun_sema::util::{FxHashMap, FxHashSet, SharedSort};
use bun_sema_driver::host::to_native;

use crate::diagnostics::InternalError;
use crate::load::loaders::{
    BY_NAME, HostLoaderKind, host_loader_kind, loader_by_name, loader_name,
};
use crate::load::sources::{ModulePaths, PluginModuleName, SourceKind};
use crate::options::PathOptions;
use crate::statistics::Stage;

pub(super) fn file_ids(file_count: usize) -> impl Iterator<Item = FileId> {
    (0..file_count).map(|index| FileId(index as u32))
}

fn host_loader_of(files: &Files<'_>, file: FileId) -> HostLoader {
    files
        .compiled(file)
        .map_or(BY_NAME, |compiled| compiled.loader)
}

pub(super) fn is_linkable(files: &Files<'_>, file: FileId) -> bool {
    files.is_compiled(file) || files.role(file) == FileRole::TypesOnly
}

#[derive(Default)]
pub(super) struct FileMaps<'s> {
    primary_files: FxHashMap<&'s [u8], (FileId, HostLoader)>,
    entry_point_indexes: FxHashMap<FileId, usize>,
    entry_point_paths: FxHashSet<Vec<u8>>,
}

impl<'s> FileMaps<'s> {
    pub(super) fn collect(
        files: &Files<'s>,
        entry_point_paths: FxHashSet<Vec<u8>>,
    ) -> FileMaps<'s> {
        let mut maps = FileMaps {
            entry_point_paths,
            ..FileMaps::default()
        };
        for file in file_ids(files.modules.len()) {
            if is_linkable(files, file) {
                let path = files.modules[file.idx()].path.text;
                maps.add_linkable_file(path, file, host_loader_of(files, file));
            }
        }
        for (index, &file) in files.entry_points().iter().enumerate() {
            maps.entry_point_indexes.entry(file).or_insert(index);
        }
        maps
    }

    fn add_linkable_file(&mut self, path: &'s [u8], file: FileId, loader: HostLoader) {
        let candidate = (file, loader);
        self.primary_files
            .entry(path)
            .and_modify(|current| {
                if loader < current.1 {
                    *current = candidate;
                }
            })
            .or_insert(candidate);
    }

    fn primary_file(&self, path: &[u8]) -> Option<FileId> {
        self.primary_files.get(path).map(|primary| primary.0)
    }

    fn shadows_entry_point(&self, file: FileId, public_path: &[u8]) -> bool {
        !self.entry_point_indexes.contains_key(&file)
            && self.entry_point_paths.contains(public_path)
    }

    fn needs_suffix(&self, file: FileId, canonical_path: &[u8], public_path: &[u8]) -> bool {
        self.primary_file(canonical_path) != Some(file)
            || self.shadows_entry_point(file, public_path)
    }
}

pub(super) fn collect_entry_point_paths(
    runs_in_place: bool,
    paths: &PathOptions,
) -> FxHashSet<Vec<u8>> {
    if runs_in_place {
        return FxHashSet::default();
    }
    let names = paths.entry_point_names.iter();
    names.map(|name| compute_module_path(paths, name)).collect()
}

pub(super) struct PathContext<'a> {
    pub runs_in_place: bool,
    pub paths: &'a PathOptions,
    pub manifest: &'a Manifest,
    pub maps: &'a FileMaps<'a>,
}

pub(super) struct PathInput<'a> {
    pub file: FileId,
    pub kind: SourceKind,
    pub plugin_module: Option<&'a PluginModuleName>,
    pub file_name: &'a [u8],
    pub canonical_path: &'a [u8],
    pub host_loader: HostLoader,
    pub is_linkable: bool,
    pub is_default_library: bool,
}

pub(super) fn compute_public_path(context: &PathContext<'_>, input: &PathInput<'_>) -> Box<[u8]> {
    let maps = context.maps;
    let mut path = match input.plugin_module {
        Some(module) => plugin_public_path(&module.namespace, &module.path),
        None => match input.kind {
            SourceKind::RuntimeModule(runtime_module) => {
                let runtime_module = context.manifest.module(runtime_module.registry_id());
                return match runtime_module.and_then(|module| module.specifier.as_deref()) {
                    Some(specifier) => specifier.into(),
                    None => input.file_name.into(),
                };
            }
            SourceKind::RuntimeFunctions | SourceKind::EvaluatedText => {
                return input.file_name.into();
            }
            SourceKind::Program | SourceKind::Data | SourceKind::TypesOnly
                if input.is_default_library =>
            {
                return input.file_name.into();
            }
            SourceKind::Program | SourceKind::Data => compute_program_path(
                context.runs_in_place,
                context.paths,
                to_native(input.file_name),
                maps.entry_point_indexes.get(&input.file).copied(),
            ),
            SourceKind::TypesOnly => compute_program_path(
                context.runs_in_place,
                context.paths,
                to_native(input.file_name),
                None,
            ),
        },
    };
    if input.is_linkable && maps.needs_suffix(input.file, input.canonical_path, &path) {
        path.push(b'?');
        path.extend_from_slice(suffix_name(input.host_loader, input.file_name).as_bytes());
    }
    path.into()
}

fn suffix_name(host_loader: HostLoader, file_name: &[u8]) -> &'static str {
    match host_loader_kind(host_loader) {
        Some(HostLoaderKind::Loader(loader)) => loader_name(loader),
        Some(HostLoaderKind::ByName) | None => loader_name(loader_by_name(file_name)),
    }
}

fn plugin_public_path(namespace: &[u8], path: &[u8]) -> Vec<u8> {
    let mut public_path = Vec::with_capacity(namespace.len() + 1 + path.len());
    for &byte in namespace {
        match byte {
            b':' => public_path.extend_from_slice(b"%3a"),
            b'%' => public_path.extend_from_slice(b"%25"),
            _ => public_path.push(byte),
        }
    }
    public_path.push(b':');
    public_path.extend_from_slice(path);
    public_path
}

fn compute_program_path(
    runs_in_place: bool,
    paths: &PathOptions,
    native_path: &[u8],
    entry_point_index: Option<usize>,
) -> Vec<u8> {
    if runs_in_place {
        return native_path.to_vec();
    }
    if let Some(index) = entry_point_index {
        return compute_module_path(paths, &paths.entry_point_names[index]);
    }
    match compute_relative_path(&paths.root_directory, native_path) {
        Some(relative_path) => compute_module_path(paths, &relative_path),
        None => compute_module_path(paths, native_path),
    }
}

/// What the executable prints for a file at run time: its path from the project's folder, with forward slashes.
pub(super) fn compute_display_path(project_root: &[u8], native_path: &[u8]) -> Box<[u8]> {
    let relative_path = if is_absolute(project_root) && is_absolute(native_path) {
        compute_relative_path(project_root, native_path)
    } else {
        None
    };
    relative_path.map_or_else(|| native_path.into(), Vec::into_boxed_slice)
}

fn compute_relative_path(directory: &[u8], native_path: &[u8]) -> Option<Vec<u8>> {
    if !fits_path_buffer(directory) || !fits_path_buffer(native_path) {
        return None;
    }
    let max_length = 3 * (directory.len() + MAX_NORMALIZATION_GROWTH)
        + 1
        + (native_path.len() + MAX_NORMALIZATION_GROWTH);
    let (mut buffer, mut spill) = (path_buffer_pool::get(), Vec::new());
    let output = buf_or_spill(buffer.as_mut_slice(), &mut spill, max_length);
    Some(relative_platform_buf::<platform::Loose, false>(output, directory, native_path).to_vec())
}

const MAX_NORMALIZATION_GROWTH: usize = 2;

fn fits_path_buffer(path: &[u8]) -> bool {
    path.len() + MAX_NORMALIZATION_GROWTH <= MAX_PATH_BYTES
}

fn compute_module_path(paths: &PathOptions, relative_path: &[u8]) -> Vec<u8> {
    let mut path = paths.module_prefix.clone();
    append_sanitized_path(&mut path, relative_path);
    path
}

fn append_sanitized_path(output: &mut Vec<u8>, relative_path: &[u8]) {
    for (index, segment) in strings::split(relative_path, b"/").enumerate() {
        if index > 0 {
            output.push(b'/');
        }
        let segment: &[u8] = if segment == b".." { b"_.._" } else { segment };
        output.extend_from_slice(segment);
    }
}

pub(super) fn check_unique_public_paths<'a>(
    paths: impl Iterator<Item = (FileId, ModulePaths<'a>)>,
) -> Result<(), InternalError> {
    let mut modules: Vec<(FileId, ModulePaths<'a>)> = paths.collect();
    let mut seen: FxHashSet<&[u8]> = FxHashSet::default();
    seen.reserve(modules.len());
    if modules
        .iter()
        .all(|(_, paths)| seen.insert(paths.public_path))
    {
        return Ok(());
    }
    modules.shared_sort_unstable_by_key(|&(file, paths)| (paths.public_path, file));
    let mut neighbors = modules.iter().zip(modules.iter().skip(1));
    let collision = neighbors.find(|(first, second)| first.1.public_path == second.1.public_path);
    let Some(((_, first), (_, second))) = collision else {
        return Ok(());
    };
    let parts: [&[u8]; 6] = [
        b"two modules have the path ",
        first.public_path,
        b": ",
        first.display_path,
        b", ",
        second.display_path,
    ];
    Err(InternalError {
        stage: Stage::Load,
        message: parts.concat(),
    })
}
