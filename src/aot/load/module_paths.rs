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
                let compiled = files.compiled(file);
                maps.add_linkable_file(path, file, compiled.map_or(BY_NAME, |it| it.loader));
            }
        }
        for (index, &file) in files.entry_points().iter().enumerate() {
            maps.entry_point_indexes.entry(file).or_insert(index);
        }
        maps
    }

    /// The files that a typed package's own program starts from are no entry points of the build.
    pub(super) fn forget_entry_points(&mut self) {
        self.entry_point_indexes.clear();
    }

    fn add_linkable_file(&mut self, path: &'s [u8], file: FileId, loader: HostLoader) {
        let primary = self.primary_files.entry(path).or_insert((file, loader));
        if loader < primary.1 {
            *primary = (file, loader);
        }
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
        return with_separators_of_host(native_path, cfg!(windows));
    }
    if let Some(index) = entry_point_index {
        return compute_module_path(paths, &paths.entry_point_names[index]);
    }
    match compute_relative_path(&paths.root_directory, native_path) {
        Some(relative_path) => compute_module_path(paths, &relative_path),
        None => compute_module_path(paths, native_path),
    }
}

/// The compiler writes `C:/a/b.ts`. `bun run` names that file `C:\a\b.ts`, and so does whoever asks for a module by its path.
pub(crate) fn with_separators_of_host(native_path: &[u8], is_windows: bool) -> Vec<u8> {
    let to_host = |&byte: &u8| match byte {
        b'/' if is_windows => b'\\',
        _ => byte,
    };
    native_path.iter().map(to_host).collect()
}

/// What the executable prints for a file at run time: its path from the project's folder, with forward slashes.
pub(super) fn compute_display_path(project_root: &[u8], native_path: &[u8]) -> Box<[u8]> {
    let are_absolute = is_absolute(project_root) && is_absolute(native_path);
    let relative_path = are_absolute.then(|| compute_relative_path(project_root, native_path));
    let relative_path = relative_path.flatten();
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
    // `__dirname` in an executable for Windows is `B:\~BUN\root`, and a program compares what it joins to that with the path of a module.
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

#[cfg(test)]
mod tests {
    use bun_ast::Loader;

    use super::*;
    use crate::builtins::RuntimeModule;
    use crate::load::loaders::to_host_loader;

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
            compute_module_path(&paths, b"../lib/a.ts"),
            b"B:\\~BUN\\root\\_.._\\lib\\a.ts"
        );
        assert_eq!(
            compute_module_path(&path_options(), b"../lib/a.ts"),
            b"/$bunfs/root/_.._/lib/a.ts"
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
        let path = |native, index| compute_program_path(false, &paths, native, index);
        assert_eq!(
            path(b"/project/src/main.ts", Some(1)),
            b"/$bunfs/root/worker.js"
        );
        assert_eq!(path(b"/project/src/a.ts", None), b"/$bunfs/root/src/a.ts");
        assert_eq!(path(b"/other/a.ts", None), b"/$bunfs/root/_.._/other/a.ts");
        assert_eq!(path(b"/a.ts", None), b"/$bunfs/root/_.._/a.ts");
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
        let outside = compute_program_path(false, &deep_root, b"/other/a.ts", None);
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
        let inside = compute_program_path(false, &path_options(), &native_path, None);
        assert_eq!(inside, [&b"/$bunfs/root/"[..], &native_path].concat());

        let long_root = PathOptions {
            root_directory: b"/d".repeat(MAX_PATH_BYTES / 2),
            ..path_options()
        };
        let outside = compute_program_path(false, &long_root, b"/other/a.ts", None);
        assert_eq!(outside, b"/$bunfs/root//other/a.ts");
    }

    #[test]
    fn program_paths_run_in_place() {
        let paths = path_options();
        let path = |index| compute_program_path(true, &paths, b"/project/a.ts", index);
        assert_eq!(path(None), b"/project/a.ts");
        assert_eq!(path(Some(0)), b"/project/a.ts");
        assert!(collect_entry_point_paths(true, &paths).is_empty());
    }

    #[test]
    fn escaped_parent_segments() {
        let names: [&[u8]; 3] = [b"a", b"../lib/b.js", b"../../other/c.js"];
        let paths = PathOptions {
            entry_point_names: names.map(<[u8]>::to_vec).to_vec(),
            ..path_options()
        };
        let path = |index| compute_program_path(false, &paths, b"/project/src/a.ts", Some(index));
        assert_eq!(path(0), b"/$bunfs/root/a");
        assert_eq!(path(1), b"/$bunfs/root/_.._/lib/b.js");
        assert_eq!(path(2), b"/$bunfs/root/_.._/_.._/other/c.js");
        for index in 0..names.len() {
            assert!(collect_entry_point_paths(false, &paths).contains(&path(index)));
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
            entry_point_paths: collect_entry_point_paths(false, &path_options()),
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
            entry_point_paths: collect_entry_point_paths(false, &paths),
            ..FileMaps::default()
        };
        maps.entry_point_indexes.insert(FileId(0), 0);
        maps.add_linkable_file(entry_point, FileId(0), BY_NAME);
        maps.add_linkable_file(imported, FileId(1), BY_NAME);
        let context = PathContext {
            runs_in_place: false,
            paths: &paths,
            manifest: &Manifest::default(),
            maps: &maps,
        };
        let path = |file, path: &[u8]| {
            compute_public_path(&context, &program_file(file, path, BY_NAME)).into_vec()
        };
        assert_eq!(path(0, entry_point), b"/$bunfs/root/_.._/lib/b.js");
        assert_eq!(path(1, imported), b"/$bunfs/root/_.._/lib/b.js?jsx");
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
    fn default_library_runtime_file_and_evaluated_text_keep_their_file_names() {
        let library: &[u8] = b"/bundled:///libs/lib.es5.d.ts";
        let runtime_file: &[u8] = b"/$bun/js/node/fs.ts";
        let text: &[u8] = b"/$bun/text/%2fproject%2fa.ts/7.cjs";
        let rows = [
            (SourceKind::Program, true, library),
            (SourceKind::Data, true, library),
            (SourceKind::TypesOnly, true, library),
            (runtime_kind(), false, runtime_file),
            (SourceKind::RuntimeFunctions, false, runtime_file),
            (SourceKind::EvaluatedText, false, text),
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
            let text = format!("bun-builtins-manifest\t4\nmodule\t{id}\tnode/fs.ts\t{specifier}\n");
            let manifest = Manifest::parse(text.as_bytes()).unwrap();
            let input = PathInput {
                kind: runtime_kind(),
                ..program_file(1, path, BY_NAME)
            };
            public_path_with_manifest(&manifest, &FileMaps::default(), input)
        };
        assert_eq!(path_with_specifier("node:fs"), b"node:fs");
        assert_eq!(path_with_specifier("-"), path);
    }

    #[test]
    fn suffix_names_requested_loader() {
        let path = b"/p/a.data";
        assert_eq!(suffix_name(as_text(), path), "text");
        assert_eq!(suffix_name(as_ts(), path), "ts");
        assert_eq!(suffix_name(BY_NAME, path), "file");
        assert_eq!(suffix_name(HostLoader(200), path), "file");
    }

    #[test]
    fn only_other_files_shadow_entry_point() {
        let mut maps = FileMaps {
            entry_point_paths: collect_entry_point_paths(false, &path_options()),
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
