use bun_ast::Loader;
use bun_builtin_sources::Manifest;
use bun_core::strings;
use bun_paths::resolve_path::{buf_or_spill, relative_platform_buf};
use bun_paths::{MAX_PATH_BYTES, is_absolute, path_buffer_pool, platform};
use bun_sema::program::{FileId, FileRole, Files, HostLoader};
use bun_sema::resolve::{CodeImportKind, is_plainly_normalized};
use bun_sema::util::{FxHashMap, FxHashSet, SharedSort};
use bun_sema_driver::host::to_native;

use crate::diagnostic_codes::Code;
use crate::diagnostics::{Diagnostic, InternalError};
use crate::load::loaders::{
    BY_NAME, HostLoaderKind, host_loader_kind, loader_by_name, loader_by_path, script_kind_of,
    to_host_loader,
};
use crate::load::plugin_modules::ENTRY_TEXT_NAMESPACE;
use crate::load::sources::{ModulePaths, PluginModuleName, SourceKind};
use crate::module_keys::path_of_form;
use crate::options::PathOptions;
use crate::statistics::Stage;

pub(super) fn file_ids(file_count: usize) -> impl Iterator<Item = FileId> {
    (0..file_count).map(|index| FileId(index as u32))
}

pub(super) fn is_linkable(files: &Files<'_>, file: FileId) -> bool {
    files.is_compiled(file) || files.role(file) == FileRole::TypesOnly
}

#[derive(Default)]
pub(super) struct FileMaps<'s> {
    primary_files: FxHashMap<&'s [u8], (FileId, HostLoader)>,
    paths_with_multiple_forms: FxHashSet<&'s [u8]>,
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
                let loader = files.compiled(file).map_or(BY_NAME, |it| it.loader);
                maps.add_linkable_file(path, file, loader);
            }
        }
        for (index, &file) in files.entry_points().iter().enumerate() {
            maps.entry_point_indexes.entry(file).or_insert(index);
        }
        maps
    }

    fn add_linkable_file(&mut self, path: &'s [u8], file: FileId, loader: HostLoader) {
        let primary = self.primary_files.entry(path).or_insert((file, loader));
        if primary.0 != file {
            self.paths_with_multiple_forms.insert(path);
        }
        if loader < primary.1 {
            *primary = (file, loader);
        }
    }

    fn primary_file(&self, path: &[u8]) -> Option<FileId> {
        self.primary_files.get(path).map(|primary| primary.0)
    }

    fn has_multiple_forms(&self, path: &[u8]) -> bool {
        self.paths_with_multiple_forms.contains(path)
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
    levels_above_root: usize,
) -> FxHashSet<Vec<u8>> {
    if runs_in_place {
        return FxHashSet::default();
    }
    let names = paths.entry_point_names.iter();
    names
        .map(|name| compute_module_path(paths, levels_above_root, name))
        .collect()
}

pub(super) struct PathContext<'a> {
    pub runs_in_place: bool,
    pub paths: &'a PathOptions,
    pub levels_above_root: usize,
    pub loaders: &'a [(Vec<u8>, Loader)],
    pub manifest: &'a Manifest,
    pub maps: &'a FileMaps<'a>,
}

pub(super) struct PathInput<'a> {
    pub file: FileId,
    pub kind: SourceKind,
    pub plugin_module: Option<&'a PluginModuleName>,
    pub file_name: &'a [u8],
    pub query: &'a [u8],
    pub canonical_path: &'a [u8],
    pub host_loader: HostLoader,
    pub is_linkable: bool,
    pub is_default_library: bool,
}

pub(super) fn compute_public_path(context: &PathContext<'_>, input: &PathInput<'_>) -> Box<[u8]> {
    let maps = context.maps;
    let path = match input.plugin_module {
        Some(module) if *module.namespace == *ENTRY_TEXT_NAMESPACE => return module.path.clone(),
        Some(module) => plugin_public_path(&module.namespace, &module.path),
        None => match input.kind {
            SourceKind::RuntimeModule(module) => {
                let path = compute_path_of_runtime_module(context.manifest, module.registry_id());
                return path.unwrap_or_else(|| input.file_name.into());
            }
            SourceKind::RuntimeFunctions => {
                return input.file_name.into();
            }
            SourceKind::Program | SourceKind::Data | SourceKind::TypesOnly
                if input.is_default_library =>
            {
                return input.file_name.into();
            }
            SourceKind::Program | SourceKind::Data => {
                let mut path = compute_program_path(
                    context.runs_in_place,
                    context.paths,
                    context.levels_above_root,
                    to_native(input.file_name),
                    maps.entry_point_indexes.get(&input.file).copied(),
                );
                path.extend_from_slice(input.query);
                path
            }
            SourceKind::TypesOnly => compute_program_path(
                context.runs_in_place,
                context.paths,
                0,
                to_native(input.file_name),
                None,
            ),
        },
    };
    let needs_suffix = maps.needs_suffix(input.file, input.canonical_path, &path)
        || is_data_that_only_an_attribute_asks_for(context, input);
    match input.is_linkable && needs_suffix {
        true => path_of_form(&path, requested_loader(input.host_loader, input.file_name)).into(),
        false => path.into(),
    }
}

pub(super) fn compute_name_of_third_party_file(
    manifest: &Manifest,
    kind: SourceKind,
) -> Option<Box<[u8]>> {
    let SourceKind::RuntimeModule(module) = kind else {
        return None;
    };
    let file = manifest.module(module.registry_id())?.path.as_deref()?;
    let name = file.strip_prefix(b"thirdparty/")?;
    let end = strings::last_index_of_char(name, b'.').unwrap_or(name.len());
    Some(name[..end].into())
}

pub(super) fn compute_name_of_module_held_in_part(
    manifest: &Manifest,
    kind: SourceKind,
) -> Option<Box<[u8]>> {
    let SourceKind::RuntimeModule(module) = kind else {
        return None;
    };
    let whole = manifest.module_held_in_part(module.registry_id())?;
    compute_path_of_runtime_module(manifest, whole)
}

fn compute_path_of_runtime_module(manifest: &Manifest, id: u32) -> Option<Box<[u8]>> {
    let specifier = manifest.module(id)?.specifier.as_deref()?;
    Some(match specifier.strip_prefix(b"internal/") {
        Some(name) => [b"internal:", name].concat().into(),
        None => specifier.into(),
    })
}

fn requested_loader(host_loader: HostLoader, file_name: &[u8]) -> Loader {
    match host_loader_kind(host_loader) {
        Some(HostLoaderKind::Loader(loader)) => loader,
        Some(HostLoaderKind::ByName) | None => loader_by_name(file_name),
    }
}

fn is_data_that_only_an_attribute_asks_for(
    context: &PathContext<'_>,
    input: &PathInput<'_>,
) -> bool {
    let is_data = match input.kind {
        SourceKind::Data => true,
        SourceKind::Program => {
            script_kind_of(requested_loader(input.host_loader, input.file_name)).is_none()
        }
        _ => false,
    };
    let is_file_with_data = is_data && input.plugin_module.is_none();
    if !is_file_with_data || context.maps.entry_point_indexes.contains_key(&input.file) {
        return false;
    }
    let kinds = [
        CodeImportKind::Import,
        CodeImportKind::Require,
        CodeImportKind::EntryPoint,
    ];
    let requested = requested_loader(input.host_loader, input.file_name);
    let is_only_form = !context.maps.has_multiple_forms(input.canonical_path);
    !kinds.into_iter().any(|kind| {
        let loader = loader_by_path(context.loaders, input.file_name, kind);
        to_host_loader(loader, input.file_name) == input.host_loader
            || (!context.runs_in_place && is_only_form && loader == requested)
    })
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

pub(super) fn compute_program_path(
    runs_in_place: bool,
    paths: &PathOptions,
    levels_above_root: usize,
    native_path: &[u8],
    entry_point_index: Option<usize>,
) -> Vec<u8> {
    if runs_in_place {
        return with_separators_of_host(native_path, cfg!(windows));
    }
    if let Some(index) = entry_point_index {
        let name = &paths.entry_point_names[index];
        return compute_module_path(paths, levels_above_root, name);
    }
    match compute_relative_path(&paths.root_directory, native_path) {
        Some(relative_path) => compute_module_path(paths, levels_above_root, &relative_path),
        None => compute_module_path(paths, levels_above_root, native_path),
    }
}

pub(crate) const FOLDER_ABOVE_ROOT: &[u8] = b"_.._";

pub(crate) fn count_folders(directory: &[u8]) -> usize {
    let is_separator = |byte: &u8| *byte == b'/' || (cfg!(windows) && *byte == b'\\');
    let folders = directory.split(is_separator);
    folders.filter(|folder| !folder.is_empty()).count()
}

pub(crate) fn count_levels_above(relative_path: &[u8]) -> usize {
    let folders = strings::split(relative_path, b"/");
    folders.take_while(|&folder| folder == b"..").count()
}

pub(crate) fn spell_mount_above_root(root: &[u8]) -> &[u8] {
    let folder = root.strip_suffix(b"/").unwrap_or(root);
    &root[..strings::last_index_of_char(folder, b'/').map_or(0, |at| at + 1)]
}

pub(crate) fn spell_folder_above_root(
    root: &[u8],
    levels_above_root: usize,
    level: usize,
) -> Vec<u8> {
    let (start, folders) = match (1..=levels_above_root).contains(&level) {
        true => (spell_mount_above_root(root), levels_above_root + 1 - level),
        false => (root, level),
    };
    [start, &b"_.._/".repeat(folders)[..]].concat()
}

pub(crate) fn with_separators_of_host(native_path: &[u8], is_windows: bool) -> Vec<u8> {
    let to_host = |&byte: &u8| match byte {
        b'/' if is_windows => b'\\',
        _ => byte,
    };
    native_path.iter().map(to_host).collect()
}

pub(crate) fn compute_display_path(project_root: &[u8], native_path: &[u8]) -> Box<[u8]> {
    let are_absolute = is_absolute(project_root) && is_absolute(native_path);
    let relative_path = are_absolute.then(|| compute_relative_path(project_root, native_path));
    let relative_path = relative_path.flatten();
    relative_path.map_or_else(|| native_path.into(), Vec::into_boxed_slice)
}

pub(super) fn compute_relative_path(directory: &[u8], native_path: &[u8]) -> Option<Vec<u8>> {
    if !fits_path_buffer(directory) || !fits_path_buffer(native_path) {
        return None;
    }
    if let Some(below) = find_path_below(directory, native_path) {
        return Some(below.to_vec());
    }
    let max_length = 3 * (directory.len() + MAX_NORMALIZATION_GROWTH)
        + 1
        + (native_path.len() + MAX_NORMALIZATION_GROWTH);
    let (mut buffer, mut spill) = (path_buffer_pool::get(), Vec::new());
    let output = buf_or_spill(buffer.as_mut_slice(), &mut spill, max_length);
    Some(relative_platform_buf::<platform::Loose, false>(output, directory, native_path).to_vec())
}

/// The path from `directory` to a file below it, if both paths can be compared as they are written.
fn find_path_below<'p>(directory: &[u8], path: &'p [u8]) -> Option<&'p [u8]> {
    let below = path.strip_prefix(directory)?.strip_prefix(b"/")?;
    let is_plain =
        |path: &[u8]| is_plainly_normalized(path) && !strings::contains_char(path, b'\\');
    (!cfg!(windows) && is_plain(directory) && is_plain(path)).then_some(below)
}

const MAX_NORMALIZATION_GROWTH: usize = 2;

fn fits_path_buffer(path: &[u8]) -> bool {
    path.len() + MAX_NORMALIZATION_GROWTH <= MAX_PATH_BYTES
}

pub(crate) fn read_path_above_root<'p>(
    root: &[u8],
    levels_above_root: usize,
    path: &'p [u8],
) -> Option<(usize, &'p [u8])> {
    let above = path.strip_prefix(spell_mount_above_root(root))?;
    let folders = strings::split(above, b"/");
    let spelled = folders.take_while(|&folder| folder == FOLDER_ABOVE_ROOT);
    let spelled = spelled.count().min(levels_above_root + 1);
    let below = &above[above.len().min(5 * spelled)..];
    (spelled > 0 && levels_above_root > 0).then_some((levels_above_root + 1 - spelled, below))
}

pub(crate) fn spell_with_other_levels(
    root: &[u8],
    path: &[u8],
    levels: usize,
    other_levels: usize,
) -> Vec<u8> {
    match read_path_above_root(root, levels, path) {
        None => path.to_vec(),
        Some((level, below)) => [
            &spell_folder_above_root(root, other_levels, level)[..],
            below,
        ]
        .concat(),
    }
}

pub(super) fn compute_module_path(
    paths: &PathOptions,
    levels_above_root: usize,
    relative_path: &[u8],
) -> Vec<u8> {
    let level = count_levels_above(relative_path);
    let mut path = spell_folder_above_root(&paths.module_prefix, levels_above_root, level);
    append_sanitized_path(
        &mut path,
        &relative_path[relative_path.len().min(3 * level)..],
    );
    with_separators_of_host(&path, paths.module_prefix.starts_with(b"B:/"))
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
    check_unique_public_paths_of(paths.collect())
}

pub(super) fn are_all_different<'a>(mut paths: impl Iterator<Item = &'a [u8]>) -> bool {
    let mut seen: FxHashSet<&[u8]> = FxHashSet::default();
    seen.reserve(paths.size_hint().0);
    paths.all(|path| seen.insert(path))
}

fn find_files_with_one_public_path<'a>(
    mut modules: Vec<(FileId, ModulePaths<'a>)>,
) -> Option<[ModulePaths<'a>; 2]> {
    if are_all_different(modules.iter().map(|it| it.1.public_path)) {
        return None;
    }
    modules.shared_sort_unstable_by_key(|&(file, paths)| (paths.public_path, file));
    let mut neighbors = modules.iter().zip(modules.iter().skip(1));
    let collision = neighbors.find(|(first, second)| first.1.public_path == second.1.public_path);
    collision.map(|(first, second)| [first.1, second.1])
}

pub(super) fn find_folder_named_as_parent_is_spelled<'a>(
    paths: impl Iterator<Item = (FileId, ModulePaths<'a>)>,
) -> Option<Diagnostic> {
    let [first, second] = find_files_with_one_public_path(paths.collect())?;
    let lies_in_such_folder = |paths: ModulePaths<'_>| {
        strings::split(paths.display_path, b"/").any(|folder| folder == b"_.._")
    };
    (lies_in_such_folder(first) || lies_in_such_folder(second)).then(|| {
        let arguments = [first.public_path, first.display_path, second.display_path];
        Diagnostic::new(Code::FolderNamedAsParentIsSpelled, None, &arguments)
    })
}

fn check_unique_public_paths_of(
    modules: Vec<(FileId, ModulePaths<'_>)>,
) -> Result<(), InternalError> {
    let Some([first, second]) = find_files_with_one_public_path(modules) else {
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

#[cfg(test)]
mod tests {
    use bun_ast::Loader;

    use super::*;
    use crate::builtins::RuntimeModule;
    use crate::load::loaders::to_host_loader_of_attribute;
    use crate::options::default_loaders;

    fn as_text() -> HostLoader {
        to_host_loader(Loader::Text, b"a.ts")
    }

    fn as_ts() -> HostLoader {
        to_host_loader(Loader::Ts, b"a.js")
    }

    fn path_options() -> PathOptions {
        PathOptions {
            module_prefix: b"/$bunfs/root/".to_vec(),
            root_directory: b"/project".to_vec(),
            entry_point_names: vec![b"main.js".to_vec(), b"worker.js".to_vec()],
            entry_point_file_names: Vec::new(),
        }
    }

    fn runtime_kind() -> SourceKind {
        SourceKind::RuntimeModule(RuntimeModule::NodeFs)
    }

    fn plugin_module_name(namespace: &[u8], path: &[u8]) -> PluginModuleName {
        PluginModuleName {
            namespace: namespace.into(),
            path: path.into(),
        }
    }

    fn program_file(file: u32, path: &[u8], host_loader: HostLoader) -> PathInput<'_> {
        PathInput {
            file: FileId(file),
            kind: SourceKind::Program,
            plugin_module: None,
            file_name: path,
            query: b"",
            canonical_path: path,
            host_loader,
            is_linkable: true,
            is_default_library: false,
        }
    }

    fn public_path(maps: &FileMaps<'_>, input: PathInput<'_>) -> Vec<u8> {
        public_path_with_manifest(&Manifest::default(), maps, input)
    }

    fn public_path_with_manifest(
        manifest: &Manifest,
        maps: &FileMaps<'_>,
        input: PathInput<'_>,
    ) -> Vec<u8> {
        let context = PathContext {
            runs_in_place: false,
            paths: &path_options(),
            levels_above_root: 0,
            loaders: &default_loaders(),
            manifest,
            maps,
        };
        compute_public_path(&context, &input).into_vec()
    }

    #[test]
    fn a_module_of_an_executable_for_windows_has_backslashes() {
        let paths = PathOptions {
            module_prefix: b"B:/~BUN/root/".to_vec(),
            ..path_options()
        };
        assert_eq!(
            compute_module_path(&paths, 2, b"../lib/a.ts"),
            b"B:\\~BUN\\_.._\\_.._\\lib\\a.ts"
        );
        assert_eq!(
            compute_module_path(&path_options(), 2, b"../lib/a.ts"),
            b"/$bunfs/_.._/_.._/lib/a.ts"
        );
    }

    #[test]
    fn a_path_gets_the_separators_of_the_host() {
        assert_eq!(with_separators_of_host(b"C:/a/b.ts", true), b"C:\\a\\b.ts");
        assert_eq!(with_separators_of_host(b"/a/b.ts", false), b"/a/b.ts");
    }

    fn module_paths<'a>(public_path: &'a [u8], display_path: &'a [u8]) -> ModulePaths<'a> {
        ModulePaths {
            public_path,
            display_path,
        }
    }

    #[test]
    fn program_paths_follow_options() {
        let paths = path_options();
        let path = |native, index| compute_program_path(false, &paths, 2, native, index);
        assert_eq!(
            path(b"/project/src/main.ts", Some(1)),
            b"/$bunfs/root/worker.js"
        );
        assert_eq!(path(b"/project/src/a.ts", None), b"/$bunfs/root/src/a.ts");
        assert_eq!(path(b"/other/a.ts", None), b"/$bunfs/_.._/_.._/other/a.ts");
        assert_eq!(path(b"/a.ts", None), b"/$bunfs/_.._/_.._/a.ts");
    }

    #[test]
    fn display_path_starts_at_project_root() {
        let path = |native| compute_display_path(b"/project", native).into_vec();
        assert_eq!(path(b"/project/main.ts"), b"main.ts");
        assert_eq!(path(b"/project/src/deep/main.ts"), b"src/deep/main.ts");
        assert_eq!(path(b"/other/a.ts"), b"../other/a.ts");
        assert_eq!(path(b"virtual.ts"), b"virtual.ts");
        let long_path = [&b"/project/"[..], &b"a".repeat(MAX_PATH_BYTES)].concat();
        assert_eq!(path(&long_path), long_path);
    }

    #[test]
    fn program_path_can_exceed_path_buffer() {
        let depth = MAX_PATH_BYTES / 2 - 2;
        let deep_root = PathOptions {
            root_directory: b"/d".repeat(depth),
            ..path_options()
        };
        let outside = compute_program_path(false, &deep_root, 0, b"/other/a.ts", None);
        let parents = b"_.._/".repeat(depth);
        assert_eq!(
            outside,
            [&b"/$bunfs/root/"[..], &parents, b"other/a.ts"].concat()
        );
    }

    #[test]
    fn path_beyond_path_buffer_stays_absolute() {
        let name = b"n".repeat(MAX_PATH_BYTES);
        let native_path = [&b"/project/"[..], &name, b".ts"].concat();
        let inside = compute_program_path(false, &path_options(), 0, &native_path, None);
        assert_eq!(inside, [&b"/$bunfs/root/"[..], &native_path].concat());

        let long_root = PathOptions {
            root_directory: b"/d".repeat(MAX_PATH_BYTES / 2),
            ..path_options()
        };
        let outside = compute_program_path(false, &long_root, 0, b"/other/a.ts", None);
        assert_eq!(outside, b"/$bunfs/root//other/a.ts");
    }

    #[test]
    fn program_paths_run_in_place() {
        let paths = path_options();
        let path = |index| compute_program_path(true, &paths, 0, b"/project/a.ts", index);
        assert_eq!(path(None), b"/project/a.ts");
        assert_eq!(path(Some(0)), b"/project/a.ts");
        assert!(collect_entry_point_paths(true, &paths, 0).is_empty());
    }

    #[test]
    fn escaped_parent_segments() {
        let names: [&[u8]; 3] = [b"a", b"../lib/b.js", b"../../other/c.js"];
        let paths = PathOptions {
            entry_point_names: names.map(<[u8]>::to_vec).to_vec(),
            ..path_options()
        };
        let path =
            |index| compute_program_path(false, &paths, 3, b"/project/src/a.ts", Some(index));
        assert_eq!(path(0), b"/$bunfs/root/a");
        assert_eq!(path(1), b"/$bunfs/_.._/_.._/_.._/lib/b.js");
        assert_eq!(path(2), b"/$bunfs/_.._/_.._/other/c.js");
        for index in 0..names.len() {
            assert!(collect_entry_point_paths(false, &paths, 3).contains(&path(index)));
        }
    }

    #[test]
    fn only_whole_segments_are_sanitized() {
        let mut path = Vec::new();
        append_sanitized_path(&mut path, b"../..a/b../../c");
        assert_eq!(path, b"_.._/..a/b../_.._/c");
    }

    #[test]
    fn plugin_module_path_has_namespace_with_its_separator_escaped() {
        assert_eq!(
            plugin_public_path(b"v", b"virtual:config"),
            b"v:virtual:config"
        );
        assert_eq!(plugin_public_path(b"a", b"b:c"), b"a:b:c");
        assert_eq!(plugin_public_path(b"a:b", b"c"), b"a%3ab:c");
        assert_eq!(plugin_public_path(b"a%3ab", b"c"), b"a%253ab:c");
        assert_eq!(plugin_public_path(b"a", b"b%3ac"), b"a:b%3ac");
    }

    #[test]
    fn plugin_module_name_wins_over_kind_and_entry_point() {
        let virtual_path = b"/$bun/plugin/v/virtual%3aconfig";
        let plugin_module = plugin_module_name(b"v", b"virtual:config");
        let mut maps = FileMaps::default();
        maps.entry_point_indexes.insert(FileId(0), 0);
        maps.add_linkable_file(virtual_path, FileId(0), BY_NAME);
        for kind in [SourceKind::Program, SourceKind::Data] {
            let input = PathInput {
                kind,
                plugin_module: Some(&plugin_module),
                ..program_file(0, virtual_path, BY_NAME)
            };
            assert_eq!(public_path(&maps, input), b"v:virtual:config");
        }
    }

    #[test]
    fn second_loader_of_plugin_module_has_suffix() {
        let virtual_path = b"/$bun/plugin/virt/x";
        let plugin_module = plugin_module_name(b"virt", b"x");
        let mut maps = FileMaps::default();
        maps.add_linkable_file(virtual_path, FileId(1), BY_NAME);
        maps.add_linkable_file(virtual_path, FileId(2), as_text());
        let path = |file, host_loader| {
            let input = PathInput {
                plugin_module: Some(&plugin_module),
                ..program_file(file, virtual_path, host_loader)
            };
            public_path(&maps, input)
        };
        assert_eq!(path(1, BY_NAME), b"virt:x");
        assert_eq!(path(2, as_text()), b"virt:x?text");
    }

    #[test]
    fn import_at_entry_point_name_has_suffix() {
        let (main_ts, main_js) = (b"/project/main.ts", b"/project/main.js");
        let mut maps = FileMaps {
            entry_point_paths: collect_entry_point_paths(false, &path_options(), 0),
            ..FileMaps::default()
        };
        maps.entry_point_indexes.insert(FileId(0), 0);
        maps.add_linkable_file(main_ts, FileId(0), BY_NAME);
        maps.add_linkable_file(main_js, FileId(1), BY_NAME);
        maps.add_linkable_file(main_js, FileId(2), as_text());
        let path = |file, path: &[u8], host_loader| {
            public_path(&maps, program_file(file, path, host_loader))
        };
        assert_eq!(path(0, main_ts, BY_NAME), b"/$bunfs/root/main.js");
        assert_eq!(path(1, main_js, BY_NAME), b"/$bunfs/root/main.js?jsx");
        assert_eq!(path(2, main_js, as_text()), b"/$bunfs/root/main.js?text");
    }

    #[test]
    fn import_at_sanitized_entry_point_name_has_suffix() {
        let (entry_point, imported) = (b"/lib/b.ts", b"/lib/b.js");
        let paths = PathOptions {
            entry_point_names: vec![b"../lib/b.js".to_vec()],
            ..path_options()
        };
        let mut maps = FileMaps {
            entry_point_paths: collect_entry_point_paths(false, &paths, 2),
            ..FileMaps::default()
        };
        maps.entry_point_indexes.insert(FileId(0), 0);
        maps.add_linkable_file(entry_point, FileId(0), BY_NAME);
        maps.add_linkable_file(imported, FileId(1), BY_NAME);
        let context = PathContext {
            runs_in_place: false,
            paths: &paths,
            levels_above_root: 2,
            loaders: &default_loaders(),
            manifest: &Manifest::default(),
            maps: &maps,
        };
        let path = |file, path: &[u8]| {
            compute_public_path(&context, &program_file(file, path, BY_NAME)).into_vec()
        };
        assert_eq!(path(0, entry_point), b"/$bunfs/_.._/_.._/lib/b.js");
        assert_eq!(path(1, imported), b"/$bunfs/_.._/_.._/lib/b.js?jsx");
    }

    #[test]
    fn declaration_file_takes_no_entry_point_name() {
        let path = b"/project/types/globals.d.ts";
        let mut maps = FileMaps::default();
        let index_without_name = path_options().entry_point_names.len();
        maps.entry_point_indexes
            .insert(FileId(0), index_without_name);
        maps.add_linkable_file(path, FileId(0), BY_NAME);
        let input = PathInput {
            kind: SourceKind::TypesOnly,
            ..program_file(0, path, BY_NAME)
        };
        assert_eq!(
            public_path(&maps, input),
            b"/$bunfs/root/types/globals.d.ts"
        );
    }

    #[test]
    fn unlinkable_file_has_no_suffix() {
        let path = b"/project/a.ts";
        let mut maps = FileMaps::default();
        maps.add_linkable_file(path, FileId(1), BY_NAME);
        let input = PathInput {
            is_linkable: false,
            ..program_file(2, path, as_text())
        };
        assert_eq!(public_path(&maps, input), b"/$bunfs/root/a.ts");
    }

    #[test]
    fn default_library_and_runtime_file_keep_their_file_names() {
        let library: &[u8] = b"/bundled:///libs/lib.es5.d.ts";
        let runtime_file: &[u8] = b"/$bun/js/node/fs.ts";
        let rows = [
            (SourceKind::Program, true, library),
            (SourceKind::Data, true, library),
            (SourceKind::TypesOnly, true, library),
            (runtime_kind(), false, runtime_file),
            (SourceKind::RuntimeFunctions, false, runtime_file),
        ];
        for (kind, is_default_library, path) in rows {
            let input = PathInput {
                kind,
                is_default_library,
                ..program_file(1, path, BY_NAME)
            };
            assert_eq!(public_path(&FileMaps::default(), input), path);
        }
    }

    #[test]
    fn runtime_module_path_follows_manifest() {
        let path = b"/$bun/js/node/fs.ts";
        let id = RuntimeModule::NodeFs.registry_id();
        let path_with_specifier = |specifier: &str| {
            let text = format!("bun-builtins-manifest\t6\nmodule\t{id}\tnode/fs.ts\t{specifier}\n");
            let manifest = Manifest::parse(text.as_bytes()).unwrap();
            let input = PathInput {
                kind: runtime_kind(),
                ..program_file(1, path, BY_NAME)
            };
            public_path_with_manifest(&manifest, &FileMaps::default(), input)
        };
        assert_eq!(path_with_specifier("node:fs"), b"node:fs");
        assert_eq!(path_with_specifier("internal/fs/a"), b"internal:fs/a");
        assert_eq!(path_with_specifier("-"), path);
    }

    #[test]
    fn third_party_module_is_shown_under_the_name_of_its_file() {
        let id = RuntimeModule::NodeFs.registry_id();
        let text = format!("bun-builtins-manifest\t6\nmodule\t{id}\tthirdparty/a_b.js\t@a/b\n");
        let manifest = Manifest::parse(text.as_bytes()).unwrap();
        let input = PathInput {
            kind: runtime_kind(),
            ..program_file(1, b"/$bun/js/thirdparty/a_b.js", BY_NAME)
        };
        assert_eq!(
            compute_name_of_third_party_file(&manifest, input.kind).as_deref(),
            Some(&b"a_b"[..])
        );
        assert_eq!(
            public_path_with_manifest(&manifest, &FileMaps::default(), input),
            b"@a/b"
        );
    }

    #[test]
    fn suffix_names_requested_loader() {
        let path = b"/p/a.data";
        assert_eq!(requested_loader(as_text(), path), Loader::Text);
        assert_eq!(requested_loader(as_ts(), path), Loader::Ts);
        assert_eq!(requested_loader(BY_NAME, path), Loader::File);
        assert_eq!(requested_loader(HostLoader(200), path), Loader::File);
    }

    #[test]
    fn data_that_only_an_attribute_asks_for_has_suffix() {
        let path = |file_name: &[u8], loader| {
            let host_loader = to_host_loader(loader, file_name);
            let mut maps = FileMaps::default();
            maps.add_linkable_file(file_name, FileId(1), host_loader);
            let input = PathInput {
                kind: SourceKind::Data,
                ..program_file(1, file_name, host_loader)
            };
            public_path(&maps, input)
        };
        assert_eq!(
            path(b"/project/a.json", Loader::Json),
            b"/$bunfs/root/a.json"
        );
        assert_eq!(
            path(b"/project/a.json", Loader::Text),
            b"/$bunfs/root/a.json?text"
        );
        assert_eq!(
            path(b"/project/a.ts", Loader::File),
            b"/$bunfs/root/a.ts?file"
        );
        assert_eq!(path(b"/project/a.sql", Loader::File), b"/$bunfs/root/a.sql");
        assert_eq!(
            path(b"/project/a.sql", Loader::Text),
            b"/$bunfs/root/a.sql?text"
        );
    }

    #[test]
    fn data_that_an_attribute_asks_for_as_the_name_does_stands_under_the_path() {
        let file_name = b"/project/a.json";
        let as_json = to_host_loader_of_attribute(Loader::Json);
        let path = |maps: &FileMaps<'_>, file, host_loader| {
            let input = PathInput {
                kind: SourceKind::Data,
                ..program_file(file, file_name, host_loader)
            };
            public_path(maps, input)
        };
        let mut maps = FileMaps::default();
        maps.add_linkable_file(file_name, FileId(1), as_json);
        assert_eq!(path(&maps, 1, as_json), b"/$bunfs/root/a.json");
        maps.add_linkable_file(file_name, FileId(2), BY_NAME);
        assert_eq!(path(&maps, 1, as_json), b"/$bunfs/root/a.json?json");
        assert_eq!(path(&maps, 2, BY_NAME), b"/$bunfs/root/a.json");
    }

    #[test]
    fn two_attribute_forms_are_both_keyed_by_type() {
        for (file_name, default_loader) in [
            (&b"/project/a.toml"[..], Loader::Toml),
            (b"/project/a.jsonc", Loader::Jsonc),
            (b"/project/a.yaml", Loader::Yaml),
            (b"/project/a.json5", Loader::Json5),
        ] {
            let forms = [default_loader, Loader::Text].map(to_host_loader_of_attribute);
            let mut maps = FileMaps::default();
            maps.add_linkable_file(file_name, FileId(1), forms[0]);
            maps.add_linkable_file(file_name, FileId(2), forms[1]);
            let path = |file, host_loader| {
                let input = PathInput {
                    kind: SourceKind::Data,
                    ..program_file(file, file_name, host_loader)
                };
                public_path(&maps, input)
            };
            let bare_path = [&b"/$bunfs/root"[..], &file_name[b"/project".len()..]].concat();
            assert_eq!(path(1, forms[0]), path_of_form(&bare_path, default_loader));
            assert_eq!(path(2, forms[1]), path_of_form(&bare_path, Loader::Text));
        }
    }

    #[test]
    fn only_other_files_shadow_entry_point() {
        let mut maps = FileMaps {
            entry_point_paths: collect_entry_point_paths(false, &path_options(), 0),
            ..FileMaps::default()
        };
        maps.entry_point_indexes.insert(FileId(1), 0);
        assert!(!maps.shadows_entry_point(FileId(1), b"/$bunfs/root/main.js"));
        assert!(maps.shadows_entry_point(FileId(2), b"/$bunfs/root/main.js"));
        assert!(maps.shadows_entry_point(FileId(2), b"/$bunfs/root/worker.js"));
        assert!(!maps.shadows_entry_point(FileId(2), b"/$bunfs/root/other.js"));
    }

    #[test]
    fn lowest_loader_is_primary() {
        let mut maps = FileMaps::default();
        maps.add_linkable_file(b"/p/a.ts", FileId(2), as_text());
        maps.add_linkable_file(b"/p/a.ts", FileId(1), BY_NAME);
        maps.add_linkable_file(b"/p/a.ts", FileId(3), as_ts());
        assert_eq!(maps.primary_file(b"/p/a.ts"), Some(FileId(1)));
        assert_eq!(maps.primary_file(b"/p/b.ts"), None);
        maps.add_linkable_file(b"/p/a.js", FileId(4), as_ts());
        assert_eq!(maps.primary_file(b"/p/a.js"), Some(FileId(4)));
    }

    #[test]
    fn equal_public_paths_are_internal_error() {
        let modules = [
            (FileId(0), module_paths(b"/same", b"/project/first.ts")),
            (FileId(1), module_paths(b"/other", b"/project/second.ts")),
            (FileId(2), module_paths(b"/same", b"/project/third.ts")),
        ];
        let expected = b"two modules have the path /same: /project/first.ts, /project/third.ts";
        let error = check_unique_public_paths(modules.into_iter()).unwrap_err();
        assert!(matches!(error.stage, Stage::Load));
        assert_eq!(error.message, expected);
        let error = check_unique_public_paths(modules.into_iter().rev()).unwrap_err();
        assert_eq!(error.message, expected);
        assert!(check_unique_public_paths(modules.into_iter().take(2)).is_ok());
    }
}
