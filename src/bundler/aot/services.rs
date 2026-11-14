use super::assets::EmbeddedFiles;
use super::plugins::PluginRequests;
use super::{assets, components, data_loaders, defines, native_plugins, page_bundles};
use crate::options_impl::BundleOptions;
use crate::{BundleV2, OutputFile, Transpiler, Worker};
use bun_alloc::Arena;
use bun_aot::load::source_provider::{
    ComponentFile, DataFailure, DeferredLoad, Failed, LoadRequest, Loaded, ModuleName,
    PathsOfProgram, RefusedText, Resolution, ResolveRequest, SourceFile,
};
use bun_aot::{SourceProvider, WithoutServices};
use bun_ast::{ASTMemoryAllocator, Loader, Log, Msg, SideEffects};
use bun_core::ZBox;
use bun_js_parser::{Define, ExpandedImportMetaGlob};
use bun_paths::resolve_path::posix_to_platform_in_place;
use bun_paths::string_paths::without_trailing_slash_windows_path;
use bun_react_compiler::Observer;
use bun_resolver::compiled_program::{RefusedData, encode_refused_data};
use bun_resolver::options::{ExternalModules, Packages};
use bun_resolver::package_json::Status;
use bun_resolver::package_names::{
    BuildPaths, FurtherPackageName, PackageName, PathAlias, RefusedName,
};
use bun_resolver::{DataURL, GlobalCache, Resolver, ResultUnion};
use bun_sema::atom::Interner;
use bun_sema::fold::FoldOptions;
use bun_sema::hir_from_data::DataModule;
use bun_sema::resolve::{AOT_CONDITION, CodeFailure, CodeImportKind, FileSearch, FoundCode, Host};
use bun_sema::util::FxHashSet;
use bun_sema_driver::host::{from_native, is_regular_file, to_native};
use bun_threading::Guarded;
use core::ptr::NonNull;
use std::borrow::Cow;

pub(crate) struct BuildContext {
    bundle: NonNull<BundleV2<'static>>,
    pub module_prefix: Box<[u8]>,
}

// SAFETY: immutable after its phase. `build` finishes setting up the carrier before `compile`
// starts, and the fields read through this pointer do not change until `compile` returns.
// `plugins.rs` alone makes a `&mut BundleV2` from it, under its lock.
unsafe impl Send for BuildContext {}
// SAFETY: as for `Send`.
unsafe impl Sync for BuildContext {}

impl BuildContext {
    pub(crate) fn bundle(&self) -> &BundleV2<'static> {
        // SAFETY: `build` keeps the carrier alive until `BundlerServices::shut_down` has returned,
        // and every `BuildContext` is gone by then.
        unsafe { self.bundle.as_ref() }
    }

    pub(crate) fn bundle_pointer(&self) -> NonNull<BundleV2<'static>> {
        self.bundle
    }

    pub(crate) fn options(&self) -> &BundleOptions<'static> {
        &self.bundle().transpiler().options
    }

    pub(crate) fn with_worker<R>(
        &self,
        work: impl FnOnce(&mut Transpiler<'static>, &Arena) -> R,
    ) -> R {
        let mut worker = scopeguard::guard(Worker::get(self.bundle()), |worker| worker.unget());
        let data = worker.data.as_mut().expect("Worker::get creates it");
        with_ast_scope(|arena| work(&mut data.transpiler, arena))
    }
}

pub(crate) fn with_ast_scope<R>(work: impl FnOnce(&Arena) -> R) -> R {
    let arena = Arena::new();
    let mut store = ASTMemoryAllocator::borrowing(&arena);
    let _scope = store.enter();
    work(&arena)
}

/// Bun's resolver, asked which file runs for an import.
pub struct FileFinder(Resolver<'static>);

// SAFETY: one thread at a time holds it. What it points to belongs to the transpiler it was made from, which is not
// written while it lives, or to every resolver of the process, which share it under their own locks.
unsafe impl Send for FileFinder {}

impl FileFinder {
    /// `conditions`: those of "exports" and "imports" that hold beside the ones of `transpiler`.
    ///
    /// # Safety
    /// `transpiler` outlives what is returned and is not written in the meantime.
    pub unsafe fn new(transpiler: &Transpiler<'_>, conditions: &[Vec<u8>]) -> FileFinder {
        let mut options = crate::transpiler::resolver_bundle_options_subset(&transpiler.options);
        // Whoever asks has taken out what is external and the modules of Bun's own that it has.
        options.mark_builtins_as_external = false;
        options.packages = Packages::Bundle;
        options.external = ExternalModules::default();
        options.preserve_symlinks = transpiler.resolver.opts.preserve_symlinks;
        // `bun build` adds "development" by itself. A compiled program runs the files that `bun run` runs.
        let mut asked_for = transpiler.options.custom_conditions.iter();
        if !asked_for.any(|condition| **condition == *b"development") {
            options.conditions.import.swap_remove(b"development");
            options.conditions.require.swap_remove(b"development");
        }
        for condition in conditions {
            options.conditions.import.insert(condition, ());
            options.conditions.require.insert(condition, ());
        }
        let resolver = &transpiler.resolver;
        // SAFETY: the caller's.
        FileFinder(unsafe { Resolver::for_worker(resolver, resolver.log, options) })
    }

    pub fn find(&mut self, search: &FileSearch<'_>) -> FoundCode {
        with_ast_scope(|_| self.find_in_ast_scope(search))
    }

    // The resolver reads `package.json` and `tsconfig.json` into the thread's store of trees.
    fn find_in_ast_scope(&mut self, search: &FileSearch<'_>) -> FoundCode {
        let resolver = &mut self.0;
        let kind = match search.kind {
            CodeImportKind::EntryPoint => bun_ast::ImportKind::EntryPointBuild,
            CodeImportKind::Import => bun_ast::ImportKind::Stmt,
            CodeImportKind::Require => bun_ast::ImportKind::Require,
        };
        let mut unread_log = Log::init();
        // SAFETY: the resolver and `unread_log` outlive the guard.
        let _log_scope =
            unsafe { Resolver::scoped_log(&raw mut *resolver, NonNull::from(&mut unread_log)) };
        resolver.prefer_module_field = search.prefers_module_field;
        resolver.esm_failure = None;
        let mut directory = to_native(search.directory).to_vec();
        posix_to_platform_in_place(&mut directory);
        if directory.last() != Some(&bun_paths::SEP) {
            directory.push(bun_paths::SEP);
        }
        let result = resolver.resolve_and_auto_install(
            &directory,
            search.specifier,
            kind,
            GlobalCache::disable,
        );
        let failure = resolver.esm_failure.take();
        let result = match result {
            ResultUnion::Success(result) => result,
            ResultUnion::Failure(_) | ResultUnion::Pending(_) | ResultUnion::NotFound => {
                return failure.map_or_else(FoundCode::not_found, describe_failure);
            }
        };
        match result.path_const() {
            None => FoundCode::not_found(),
            Some(path) if result.flags.is_external() || path.is_data_url() => {
                FoundCode::External(path.text.to_vec())
            }
            Some(path) => FoundCode::File {
                path: from_native(path.text),
                required: (result.path_pair.secondary.as_ref()).map(|it| from_native(it.text)),
                links_followed: true,
                has_side_effects: matches!(
                    result.primary_side_effects_data,
                    SideEffects::HasSideEffects
                ),
            },
        }
    }
}

fn describe_failure(status: Status) -> FoundCode {
    let failure = match status {
        Status::InvalidModuleSpecifier => CodeFailure::InvalidModuleSpecifier,
        Status::InvalidPackageConfiguration => CodeFailure::InvalidPackageConfiguration,
        Status::InvalidPackageTarget => CodeFailure::InvalidPackageTarget,
        Status::UnsupportedDirectoryImport => CodeFailure::UnsupportedDirectoryImport,
        Status::PackageImportNotDefined => CodeFailure::PackageImportNotDefined,
        Status::Exact
        | Status::ExactEndsWithStar
        | Status::Inexact
        | Status::PackageResolve
        | Status::ModuleNotFound => CodeFailure::ModuleNotFound,
        Status::Undefined
        | Status::UndefinedNoConditionsMatch
        | Status::Null
        | Status::PackagePathNotExported
        | Status::PackagePathDisabled => CodeFailure::PackagePathNotExported,
    };
    FoundCode::NotFound(failure)
}

#[cfg(test)]
pub(crate) fn with_test_context<R>(
    configure: impl FnOnce(&mut BundleOptions<'_>),
    then: impl FnOnce(&BuildContext) -> R,
) -> R {
    static OUTPUT: std::sync::Once = std::sync::Once::new();
    OUTPUT.call_once(bun_core::output::stdio::init);
    let mut log = Log::init();
    let event_loop = bun_event_loop::AnyEventLoop::default();
    let arena = Arena::new();
    let transform_options = crate::options::TransformOptions {
        absolute_working_dir: Some(Box::from(&b"/project"[..])),
        target: Some(bun_options_types::schema::api::Target::Bun),
        ..Default::default()
    };
    let transpiler = arena.alloc(
        Transpiler::init(&arena, &raw mut log, transform_options, None)
            .expect("default options are valid"),
    );
    configure(&mut transpiler.options);
    let mut bundle = BundleV2::init(
        transpiler,
        None,
        &arena,
        Some(NonNull::from(&event_loop)),
        false,
        None,
        &arena,
    )
    .expect("the carrier starts");
    let context = BuildContext {
        bundle: NonNull::from(&mut *bundle).cast(),
        module_prefix: Box::from(&b"/$bunfs/root/"[..]),
    };
    let result = then(&context);
    drop(context);
    bundle.deinit_without_freeing_arena();
    drop(bundle);
    result
}

pub(crate) struct BundlerServices {
    context: BuildContext,
    user_defined_names: Box<[Box<[u8]>]>,
    plugins: Option<PluginRequests>,
    embedded: EmbeddedFiles,
    /// Those that no thread holds.
    file_finders: Guarded<Vec<FileFinder>>,
    refused_names: Guarded<Vec<RefusedName>>,
    /// `CompiledProgram::refused_data`
    refused_data: Guarded<Vec<u8>>,
    files_for_file_system: Guarded<FilesForFileSystem>,
    /// What `--asset` names, by absolute paths.
    assets: Box<[Vec<u8>]>,
    /// An asset below this folder is embedded under its path from the root, where the code beside it looks for it. Any other is embedded under its name alone.
    assets_root: Vec<u8>,
    names_wanted: NamesWanted,
    names_of_packages: Guarded<NamesOfPackages>,
}

pub(super) fn is_at_or_below(path: &[u8], ancestor: &[u8]) -> bool {
    let rest = path.strip_prefix(ancestor);
    rest.is_some_and(|rest| rest.first().is_none_or(|&byte| bun_paths::is_sep_any(byte)))
}

fn is_package_json(path: &[u8]) -> bool {
    bun_paths::basename(path) == b"package.json"
}

/// The front end writes `/` on every platform, as in `C:/a`. Paths are compared by their bytes here.
fn with_platform_separators(path: &[u8]) -> Cow<'_, [u8]> {
    if bun_paths::SEP == b'/' {
        return Cow::Borrowed(path);
    }
    let mut path = path.to_vec();
    posix_to_platform_in_place(&mut path);
    Cow::Owned(path)
}

fn count_levels_above(root: &[u8], asset: &[u8]) -> usize {
    let Some(written_folder) = bun_paths::dirname(asset) else {
        return 0;
    };
    let mut buffer = bun_paths::path_buffer_pool::get();
    let real_folder = bun_sys::realpath(&ZBox::from_bytes(written_folder), &mut buffer).ok();
    let folders = [real_folder, Some(written_folder)];
    if folders.iter().flatten().any(|it| is_at_or_below(it, root)) {
        return 0;
    }
    let relative = bun_paths::resolve_path::relative(root, real_folder.unwrap_or(written_folder));
    let steps = relative.split(|&byte| bun_paths::is_sep_any(byte));
    steps.take_while(|&step| step == b"..").count()
}

const LOCK_FILES: [&[u8]; 6] = [
    b"bun.lock",
    b"bun.lockb",
    b"npm-shrinkwrap.json",
    b"package-lock.json",
    b"pnpm-lock.yaml",
    b"yarn.lock",
];

/// `path` is below a folder that is directly below `node_modules`, or below a scope there, and holds a `package.json`. Hidden files, files in hidden folders and lock files don't count.
fn is_installed_package_file(path: &[u8]) -> bool {
    let segments: Vec<&[u8]> = path.split(|&byte| bun_paths::is_sep_any(byte)).collect();
    let is_store = |&segment: &&[u8]| segment == b"node_modules";
    let Some(innermost) = segments.iter().rposition(is_store) else {
        return false;
    };
    let below = &segments[innermost + 1..];
    let is_scoped = below.first().is_some_and(|it| it.first() == Some(&b'@'));
    let package_depth = if is_scoped { 2 } else { 1 };
    if below.len() <= package_depth
        || below.iter().any(|it| it.first() == Some(&b'.'))
        || below.last().is_some_and(|it| LOCK_FILES.contains(it))
    {
        return false;
    }
    let package = segments[..=innermost + package_depth].iter();
    let length: usize = package.map(|it| it.len() + 1).sum();
    let manifest = ZBox::from_bytes([&path[..length], b"package.json"].concat());
    let kind = bun_sys::exists_at_type(bun_sys::Fd::cwd(), &manifest);
    matches!(kind, Ok(bun_sys::ExistsAtType::File))
}

/// Without the packages below it.
fn list_files_below(folder: &[u8]) -> Vec<Vec<u8>> {
    let mut pending = vec![folder.to_vec()];
    let mut below = Vec::new();
    while let Some(folder) = pending.pop() {
        if let Some((files, folders)) = list_folder(&folder) {
            let is_store = |path: &Vec<u8>| bun_paths::basename(path) == b"node_modules";
            below.extend(files);
            pending.extend(folders.into_iter().filter(|it| !is_store(it)));
        }
    }
    below.sort_unstable();
    below
}

/// The paths of the files and the folders in `folder` itself.
fn list_folder(folder: &[u8]) -> Option<(Vec<Vec<u8>>, Vec<Vec<u8>>)> {
    let directory = bun_sys::open_dir_for_iteration(bun_sys::Fd::cwd(), folder)
        .map(bun_sys::File::from_fd)
        .ok()?;
    let mut entries = bun_sys::dir_iterator::iterate(directory.fd());
    let (mut files, mut folders) = (Vec::new(), Vec::new());
    while let Some(entry) = entries.next().ok()? {
        let path = [folder, &[bun_paths::SEP], entry.name.slice_u8()].concat();
        match entry.kind {
            bun_sys::EntryKind::File => files.push(path),
            bun_sys::EntryKind::Directory => folders.push(path),
            _ => {}
        }
    }
    Some((files, folders))
}

/// `path` lies below the folder of `manifest` with no `node_modules` above it. Files in hidden folders need `--asset`, as in a package.
fn is_application_file_under(manifest: &[u8], path: &[u8]) -> bool {
    let folder = bun_paths::dirname(manifest).unwrap_or_default();
    let mut below = path[folder.len()..].split(|&byte| bun_paths::is_sep_any(byte));
    find_node_modules_parent(path).is_none() && !below.any(|it| it.first() == Some(&b'.'))
}

/// A program or a library of machine code. A process is started from it, or it is loaded.
fn is_native_program(path: &[u8]) -> bool {
    const ELF: &[u8] = b"\x7fELF";
    const MACH_O: [&[u8]; 5] = [
        b"\xfe\xed\xfa\xce",
        b"\xfe\xed\xfa\xcf",
        b"\xce\xfa\xed\xfe",
        b"\xcf\xfa\xed\xfe",
        b"\xca\xfe\xba\xbe",
    ];
    if !is_regular_file(path) {
        return false;
    }
    let Ok(file) = bun_sys::File::openat(bun_sys::Fd::cwd(), path, bun_sys::O::RDONLY, 0) else {
        return false;
    };
    let mut start = [0; 4];
    let read = file.read_all(&mut start).unwrap_or(0);
    let start = &start[..read];
    start == ELF || start.starts_with(b"MZ") || MACH_O.contains(&start)
}

fn is_readable(path: &[u8]) -> bool {
    bun_sys::File::openat(bun_sys::Fd::cwd(), path, bun_sys::O::RDONLY, 0).is_ok()
}

/// The folder that holds the outermost `node_modules` of `path`.
fn find_node_modules_parent(path: &[u8]) -> Option<&[u8]> {
    let mut start = 0;
    for segment in path.split(|&byte| bun_paths::is_sep_any(byte)) {
        if segment == b"node_modules" {
            return Some(&path[..start.max(1) - 1]);
        }
        start += segment.len() + 1;
    }
    None
}

/// The folder of the innermost installed package that `path` lies in.
fn find_package_root(path: &[u8]) -> Option<&[u8]> {
    let (mut segments, mut start) = (Vec::new(), 0);
    for segment in path.split(|&byte| bun_paths::is_sep_any(byte)) {
        start += segment.len() + 1;
        segments.push((segment, start - 1));
    }
    let store = segments.iter().rposition(|it| it.0 == b"node_modules")?;
    let is_scoped = segments.get(store + 1)?.0.first() == Some(&b'@');
    let end = segments.get(store + if is_scoped { 2 } else { 1 })?.1;
    Some(&path[..end])
}

/// `path` is an existing file.
fn is_nearest_package_json(entry_path: &[u8], path: &[u8]) -> bool {
    let holder = bun_paths::dirname(path).filter(|_| bun_paths::basename(path) == b"package.json");
    let mut folder = bun_paths::dirname(entry_path);
    while let (Some(holder), Some(current)) = (holder, folder) {
        let nearer = ZBox::from_bytes([current, b"/package.json"].concat());
        if current == holder || bun_sys::exists_at_type(bun_sys::Fd::cwd(), &nearer).is_ok() {
            return current == holder;
        }
        folder = bun_paths::dirname(current).filter(|above| above.len() < current.len());
    }
    false
}

/// Embedding an asset's folder does not follow symlinks below it, so their targets are not embedded. `asset` itself may be a symlink.
fn is_reached_through_symlink(asset: &[u8], path: &[u8]) -> bool {
    let (mut first, mut second) = (
        bun_paths::path_buffer_pool::get(),
        bun_paths::path_buffer_pool::get(),
    );
    let real_asset = bun_sys::realpath(&ZBox::from_bytes(asset), &mut first).ok();
    let real_path = bun_sys::realpath(&ZBox::from_bytes(path), &mut second).ok();
    let matches_written_path = |(real_asset, real_path): (&[u8], &[u8])| {
        real_path.strip_prefix(real_asset) == path.strip_prefix(asset)
    };
    !real_asset.zip(real_path).is_some_and(matches_written_path)
}

/// Purely lexical, because the executable does not follow symlinks.
fn count_lexical_levels_above(root: &[u8], written: &[u8]) -> usize {
    let folder = bun_paths::dirname(written).unwrap_or(written);
    let relative = bun_paths::resolve_path::relative(root, folder);
    let steps = relative.split(|&byte| bun_paths::is_sep_any(byte));
    steps.take_while(|&step| step == b"..").count()
}

pub(crate) struct NamesWanted {
    pub(crate) runs_in_place: bool,
    pub(crate) loads_code_from_disk: bool,
    pub(crate) root_directory: Box<[u8]>,
}

#[derive(Default)]
pub(crate) struct NamesOfPackages {
    pub(crate) of_entry_points_and_folders: Vec<PackageName>,
    pub(crate) path_aliases: Vec<PathAlias>,
    pub(crate) nearer: Vec<PackageName>,
    pub(crate) that_lead_outside: Vec<PackageName>,
    pub(crate) further: Vec<FurtherPackageName>,
}

impl BundlerServices {
    pub(crate) fn new(
        bundle: NonNull<BundleV2<'static>>,
        module_prefix: &[u8],
        user_defined_names: &[Box<[u8]>],
        names_wanted: NamesWanted,
    ) -> BundlerServices {
        let context = BuildContext {
            bundle,
            module_prefix: Box::from(module_prefix),
        };
        let plugins = context
            .bundle()
            .plugins
            .is_some()
            .then(|| PluginRequests::new(bundle));
        BundlerServices {
            context,
            user_defined_names: Box::from(user_defined_names),
            plugins,
            embedded: EmbeddedFiles::default(),
            file_finders: Guarded::new(Vec::new()),
            refused_names: Guarded::new(Vec::new()),
            refused_data: Guarded::new(Vec::new()),
            files_for_file_system: Guarded::new(FilesForFileSystem::default()),
            assets: Box::default(),
            assets_root: Vec::new(),
            names_wanted,
            names_of_packages: Guarded::new(NamesOfPackages::default()),
        }
    }

    pub(crate) fn with_assets(
        mut self,
        assets: Box<[Vec<u8>]>,
        assets_root: Vec<u8>,
    ) -> BundlerServices {
        self.assets = assets;
        self.assets_root = assets_root;
        self
    }

    pub(crate) fn take_names_of_packages(&self) -> NamesOfPackages {
        core::mem::take(&mut *self.names_of_packages.lock())
    }

    pub(crate) fn take_refused_names(&self) -> Vec<RefusedName> {
        core::mem::take(&mut *self.refused_names.lock())
    }

    pub(crate) fn take_refused_data(&self) -> Vec<u8> {
        core::mem::take(&mut *self.refused_data.lock())
    }

    /// `SourceProvider::embed_file_implicitly()` for a file of a kind that may be embedded.
    fn embed_eligible_file(&self, module_path: &[u8], source_path: &[u8], is_query: bool) -> bool {
        let reads_unknown_paths = self.files_for_file_system.lock().reads_unknown_paths;
        let written_path = source_path;
        let module_path = &*with_platform_separators(module_path);
        let source_path = &*with_platform_separators(source_path);
        if self.names_wanted.runs_in_place {
            return false;
        }
        let is_around = |asset: &Vec<u8>| is_at_or_below(source_path, asset);
        if self.assets.iter().any(is_around) || self.is_found_by_pattern(written_path) {
            return false;
        }
        // A file is embedded at its real path, where a read through a symlink does not find it, and a symlink may lead to a file of the application.
        let unlinked =
            find_node_modules_parent(source_path).or_else(|| bun_paths::dirname(source_path));
        if unlinked.is_none_or(|folder| is_reached_through_symlink(folder, source_path)) {
            return false;
        }
        // The levels above the root are already settled. They reach as far up as code does, and one level always exists.
        let root = without_trailing_slash_windows_path(&self.names_wanted.root_directory);
        let highest = count_lexical_levels_above(root, module_path).max(1);
        let is_embedded = count_lexical_levels_above(root, source_path) <= highest
            && is_regular_file(source_path)
            && match is_query {
                // What finds it there may read it. A program of machine code is started, which needs the disk.
                true if reads_unknown_paths => {
                    is_readable(source_path) && !is_native_program(source_path)
                }
                is_query => is_query || is_readable(source_path),
            };
        if is_embedded {
            let has_no_bytes = is_query && !reads_unknown_paths;
            (self.files_for_file_system.lock()).embed(source_path, has_no_bytes);
        }
        is_embedded
    }

    /// `SourceProvider::fill_package_json_gaps()` for the modules in `folder`. A folder in `closed` is done, and so are those above it. A `package.json` between compiled code and one that is embedded may be the application's own.
    fn fill_gaps_above(
        &self,
        folder: &[u8],
        closed: &mut FxHashSet<Vec<u8>>,
        added: &mut Vec<(Vec<u8>, Vec<u8>)>,
    ) {
        let is_above = |path: &[u8]| {
            let above = bun_paths::dirname(path).filter(|_| is_package_json(path));
            above.is_some_and(|above| is_at_or_below(folder, above))
        };
        let files = self.files_for_file_system.lock();
        let embedded = files.embedded_manifests.iter().filter(|it| is_above(it));
        let mut embedded: Vec<Box<[u8]>> = embedded.cloned().collect();
        drop(files);
        embedded.sort_unstable_by_key(|it| it.len());
        let Some(farthest) = embedded.first() else {
            return;
        };
        let mut current = Some(folder);
        while let Some(here) = current {
            let path = [here, &[bun_paths::SEP], b"package.json"].concat();
            if path.len() <= farthest.len() || !closed.insert(here.to_vec()) {
                return;
            }
            current = bun_paths::dirname(here).filter(|above| above.len() < here.len());
            let is_present = embedded.iter().any(|it| **it == *path)
                || self.assets.iter().any(|asset| is_at_or_below(&path, asset));
            let kind = bun_sys::exists_at_type(bun_sys::Fd::cwd(), &ZBox::from_bytes(&path));
            if is_present || kind.is_err() {
                continue;
            }
            let is_eligible =
                is_installed_package_file(&path) || is_application_file_under(farthest, &path);
            if !is_eligible || !self.embed_eligible_file(folder, &path, false) {
                let mut files = self.files_for_file_system.lock();
                files.take_out(|it| it.len() < path.len() && embedded.contains(it));
                return;
            }
            let found = embedded.iter().rfind(|it| it.len() < path.len());
            added.extend(found.map(|found| (path, found.to_vec())));
        }
    }

    /// A search may start in any folder of a package, as in `find(path.join(__dirname, "esm"))`. So each `package.json` below one of a package that is embedded is embedded too, whether or not code lies beside it. Another package in a `node_modules` below has its own.
    fn fill_gaps_in_packages(&self, added: &mut Vec<(Vec<u8>, Vec<u8>)>) {
        let files = self.files_for_file_system.lock();
        let of_packages = files
            .embedded_manifests
            .iter()
            .filter(|it| is_installed_package_file(it));
        let mut embedded: Vec<Box<[u8]>> = of_packages.cloned().collect();
        drop(files);
        // The farthest first, so that a folder is listed once.
        embedded.sort_unstable_by_key(|it| it.len());
        let mut listed: Vec<&[u8]> = Vec::new();
        for manifest in &embedded {
            let Some(folder) = bun_paths::dirname(manifest) else {
                continue;
            };
            // The walk below a folder stops at a `node_modules`, so a package in there is walked for itself.
            let is_listed = |above: &&[u8]| {
                find_package_root(above) == find_package_root(folder)
                    && is_at_or_below(folder, above)
            };
            if listed.iter().any(is_listed) {
                continue;
            }
            listed.push(folder);
            for path in list_files_below(folder) {
                let is_new = is_package_json(&path) && !embedded.iter().any(|it| **it == *path);
                if is_new && self.embed_eligible_file(manifest, &path, false) {
                    added.push((path, manifest.to_vec()));
                }
            }
        }
    }

    fn is_found_by_pattern(&self, source_path: &[u8]) -> bool {
        let files = self.files_for_file_system.lock();
        let mut found = files.data_found_by_patterns.iter();
        found.any(|found| &found[..] == source_path)
    }

    /// The executable's folders reach as far above the root as code does.
    fn is_near_code(&self, module_path: &[u8], source_path: &[u8]) -> bool {
        let root = without_trailing_slash_windows_path(&self.names_wanted.root_directory);
        let is_beside_code = || {
            let levels = count_lexical_levels_above(root, source_path);
            levels > 0 && levels <= count_lexical_levels_above(root, module_path)
        };
        is_at_or_below(source_path, &self.assets_root) || is_beside_code()
    }

    fn is_embeddable_as_asset(&self, module_path: &[u8], source_path: &[u8]) -> bool {
        let module_path = &*with_platform_separators(module_path);
        let source_path = &*with_platform_separators(source_path);
        let kind = || bun_sys::exists_at_type(bun_sys::Fd::cwd(), &ZBox::from_bytes(source_path));
        let is_around = |asset: &&Vec<u8>| is_at_or_below(source_path, asset);
        let mut around = self.assets.iter().filter(is_around).peekable();
        let is_left_out = match around.peek() {
            None => self.is_near_code(module_path, source_path),
            Some(_) => around.all(|asset| is_reached_through_symlink(asset, source_path)),
        };
        is_left_out && matches!(kind(), Ok(bun_sys::ExistsAtType::File))
    }

    pub(crate) fn take_files_for_file_system(&self) -> FilesForFileSystem {
        let mut files = core::mem::take(&mut *self.files_for_file_system.lock());
        let (found, seen) = (&mut files.data_found_by_patterns, &mut files.code_seen);
        let (embedded, asked_about) = (&mut files.implicitly_embedded, &mut files.asked_about);
        for paths in [found, seen, &mut *embedded, &mut *asked_about] {
            paths.sort_unstable();
            paths.dedup();
        }
        asked_about.retain(|path| embedded.binary_search(path).is_err());
        let key = |kept: &(Box<[u8]>, Msg)| {
            let place = kept.1.data.location.as_ref();
            let place = place.map(|it| (it.file.clone(), it.line, it.column));
            (place, kept.1.data.text.clone())
        };
        files.warnings_if_not_embedded.sort_by_cached_key(key);
        files
            .warnings_if_not_embedded
            .dedup_by_key(|kept| key(kept));
        files
    }

    pub(crate) fn shut_down(self) -> Vec<OutputFile> {
        if let Some(plugins) = self.plugins {
            plugins.shut_down();
        }
        self.embedded.into_output_files()
    }
}

/// Where they lie on the disk of the build, ascending.
#[derive(Default)]
pub struct FilesForFileSystem {
    /// The data files that a path made at run time may name.
    pub data_found_by_patterns: Vec<Box<[u8]>>,
    /// The compiled files that `node:fs` finds in the executable. Empty where there is no such data file.
    pub code_seen: Vec<Box<[u8]>>,
    /// `SourceProvider::embed_file_implicitly`.
    pub implicitly_embedded: Vec<Box<[u8]>>,
    /// Those that the program only asks about. None is in `implicitly_embedded`.
    pub asked_about: Vec<Box<[u8]>>,
    /// What both lists hold, and each `package.json` of the first.
    embedded_index: FxHashSet<Box<[u8]>>,
    asked_about_index: FxHashSet<Box<[u8]>>,
    embedded_manifests: Vec<Box<[u8]>>,
    /// `SourceProvider::note_reads_of_unknown_paths`.
    reads_unknown_paths: bool,
    /// A data file's path and the warning if `node:fs` can't find it. Sorted, without duplicates.
    pub warnings_if_not_embedded: Vec<(Box<[u8]>, Msg)>,
}

impl FilesForFileSystem {
    fn is_embedded(&self, path: &[u8], is_query: bool) -> bool {
        self.embedded_index.contains(path) || is_query && self.asked_about_index.contains(path)
    }

    fn embed(&mut self, path: &[u8], is_query: bool) {
        let (paths, index) = match is_query {
            true => (&mut self.asked_about, &mut self.asked_about_index),
            false => (&mut self.implicitly_embedded, &mut self.embedded_index),
        };
        if index.insert(path.into()) {
            paths.push(path.into());
            if !is_query && is_package_json(path) {
                self.embedded_manifests.push(path.into());
            }
        }
    }

    fn take_out(&mut self, is_out: impl Fn(&Box<[u8]>) -> bool) {
        self.implicitly_embedded.retain(|it| !is_out(it));
        self.embedded_index.retain(|it| !is_out(it));
        self.embedded_manifests.retain(|it| !is_out(it));
    }
}

impl SourceProvider for BundlerServices {
    fn work_beside_engine(&self, paths: &PathsOfProgram<'_>) {
        let wanted = &self.names_wanted;
        let pair = |source_path, public_path| BuildPaths {
            source_path,
            public_path,
        };
        let entry_points = paths.entry_points.iter();
        let entry_points: Vec<BuildPaths<'_>> = entry_points
            .map(|it| pair(&it.source_path, &it.public_path))
            .collect();
        let folders = paths.folders.iter();
        let folders: Vec<BuildPaths<'_>> = folders
            .map(|it| pair(&it.source_path, &it.public_path))
            .collect();
        let files = paths.program_files.iter();
        let files: Vec<BuildPaths<'_>> = files
            .map(|it| pair(&it.source_path, &it.public_path))
            .collect();
        // SAFETY: the front end has ended, so no thread resolves or loads; `build`, which owns the carrier, waits in `bun_aot::compile`.
        let resolver = unsafe {
            &mut (*self.context.bundle_pointer().as_ptr())
                .transpiler
                .resolver
        };
        let mut names = NamesOfPackages::default();
        with_ast_scope(|_| {
            // A program that runs in place asks the disk, and one entry point is loaded by nobody.
            if !wanted.runs_in_place && entry_points.len() > 1 {
                names.of_entry_points_and_folders =
                    resolver.find_package_names(&entry_points, &folders);
                names.path_aliases = resolver.find_path_aliases(&folders);
            }
            if !wanted.runs_in_place {
                names.nearer = resolver.find_nearer_packages(&folders);
                names.that_lead_outside =
                    resolver.find_names_that_lead_outside(&files, &entry_points);
            }
            if wanted.loads_code_from_disk && !files.is_empty() {
                let root = pair(&wanted.root_directory, &self.context.module_prefix);
                names.further = resolver.find_further_package_names(&files, root);
            }
        });
        *self.names_of_packages.lock() = names;
    }

    fn fold_options<'s>(
        &self,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        log: &mut Log,
    ) -> FoldOptions<'s> {
        let options = self.context.options();
        defines::fold_options(options, &self.user_defined_names, arena, atoms, log)
    }

    fn define(&self) -> Option<&Define> {
        Some(&*self.context.options().define)
    }

    fn outfile(&self) -> Option<&[u8]> {
        let resolver = &self.context.bundle().transpiler().resolver;
        resolver.outfile_of_build()
    }

    fn resolve(&self, request: &ResolveRequest<'_>, log: &mut Log) -> Result<Resolution, Failed> {
        match &self.plugins {
            Some(plugins) => plugins.resolve(request, log),
            None => Ok(Resolution::NotHandled),
        }
    }

    fn has_resolve_plugins(&self) -> bool {
        self.plugins.is_some()
    }

    fn find_file(&self, _host: &dyn Host, search: &FileSearch<'_>) -> FoundCode {
        let idle = self.file_finders.lock().pop();
        let create = || {
            let conditions = [AOT_CONDITION.to_vec()];
            // SAFETY: `build` keeps the carrier and its transpiler as they are until `shut_down` has returned.
            unsafe { FileFinder::new(self.context.bundle().transpiler(), &conditions) }
        };
        let mut finder = idle.unwrap_or_else(create);
        let found = finder.find(search);
        self.file_finders.lock().push(finder);
        if let FoundCode::NotFound(failure) = found
            && failure.is_refusal_of_package_json()
            && search.kind != CodeImportKind::EntryPoint
        {
            let mut directory = to_native(search.directory).to_vec();
            posix_to_platform_in_place(&mut directory);
            self.refused_names.lock().push(RefusedName {
                directory,
                specifier: search.specifier.to_vec(),
                is_require: search.kind == CodeImportKind::Require,
            });
        }
        found
    }

    fn load(&self, request: &LoadRequest<'_>, log: &mut Log) -> Result<Loaded, Failed> {
        let loaded = match &self.plugins {
            Some(plugins) => plugins.load(request, log)?,
            None => WithoutServices.load(request, log)?,
        };
        native_plugins::run_before_parse(&self.context, request.module, loaded, log)
    }

    fn has_load_plugin(&self, module: ModuleName<'_>) -> bool {
        self.plugins
            .as_ref()
            .is_some_and(|plugins| plugins.has_load_plugin(module))
            || native_plugins::has_before_parse_plugins(&self.context)
    }

    fn finish_deferred_loads(&self, log: &mut Log) -> Vec<DeferredLoad> {
        let Some(plugins) = &self.plugins else {
            return Vec::new();
        };
        plugins
            .finish_deferred_loads(log)
            .into_iter()
            .map(|(namespace, path, answer)| {
                let module = ModuleName {
                    namespace: &namespace,
                    path: &path,
                };
                let answer = answer.and_then(|loaded| {
                    native_plugins::run_before_parse(&self.context, module, loaded, log)
                });
                DeferredLoad {
                    namespace,
                    path,
                    answer,
                }
            })
            .collect()
    }

    fn data_url_loader(&self, url: &[u8]) -> Option<Loader> {
        use bun_http_types::MimeType::Category;
        let url = DataURL::parse(url).ok().flatten()?;
        match url.decode_mime_type().category {
            Category::Javascript => Some(Loader::Tsx),
            Category::Json => Some(Loader::Json),
            _ => None,
        }
    }

    fn decode_data_url(&self, url: &[u8]) -> Option<Vec<u8>> {
        let url = DataURL::parse(url).ok().flatten()?;
        url.decode_data().ok()
    }

    fn loader_of_blob(&self, r#type: Option<&[u8]>) -> Option<Loader> {
        use crate::options::LoaderExt as _;
        use bun_http_types::MimeType;
        // The constructor takes no type that is empty or holds more than printable ASCII. It keeps what goes with a name that it knows, and any other in lower case.
        let is_taken = |written: &&[u8]| {
            !written.is_empty() && written.iter().all(|&byte| matches!(byte, 0x20..=0x7E))
        };
        let Some(written) = r#type.filter(is_taken) else {
            return Some(Loader::from_mime_type(MimeType::NONE));
        };
        let kept = match MimeType::by_name_static(written) {
            Some(known) => known.value.into_owned(),
            None => written.to_ascii_lowercase(),
        };
        let kept = MimeType::MimeType::init(&kept, false);
        Some(Loader::from_mime_type(kept))
    }

    fn write_url(&self, text: &[u8], base: Option<&[u8]>) -> Option<Vec<u8>> {
        let text = bun_core::StringView::borrow_utf8(text);
        let href = match base {
            None => bun_url::href_from_string(&text),
            Some(base) => bun_url::join(&bun_core::StringView::borrow_utf8(base), &text),
        };
        (!href.is_dead()).then(|| href.to_owned_slice())
    }

    fn asset_paths_ignore_contents(&self) -> bool {
        assets::asset_paths_ignore_contents(&self.context)
    }

    fn set_embedded_contents(&self, file: &SourceFile<'_>, log: &mut Log) -> Result<(), Failed> {
        self.embedded.set_contents(&self.context, file, log)
    }

    fn keep_where_text_is_refused(&self, refused: &RefusedText<'_>) {
        let record = RefusedData {
            is_syntax_error: refused.is_syntax_error,
            message: refused.message,
            line: refused.line,
            column: refused.column,
            offset: refused.offset as u32,
            length: refused.length as u32,
        };
        let record = encode_refused_data(refused.path, &record);
        self.refused_data.lock().extend_from_slice(&record);
    }

    fn keep_bytes_of_data_file(&self, source_path: &[u8]) {
        let mut files = self.files_for_file_system.lock();
        files.data_found_by_patterns.push(source_path.into());
    }

    fn keep_path_of_code_that_file_system_sees(&self, source_path: &[u8]) {
        self.files_for_file_system
            .lock()
            .code_seen
            .push(source_path.into());
    }

    fn embeds_assets(&self) -> bool {
        !self.assets.is_empty() && !self.names_wanted.runs_in_place
    }

    fn highest_asset_level(&self) -> usize {
        if self.names_wanted.runs_in_place {
            return 0;
        }
        let root = without_trailing_slash_windows_path(&self.names_wanted.root_directory);
        let levels = self.assets.iter().map(|it| count_levels_above(root, it));
        levels.max().unwrap_or(0)
    }

    fn is_embeddable_only_by_asset(&self, module_path: &[u8], source_path: &[u8]) -> bool {
        !self.is_found_by_pattern(source_path)
            && self.is_embeddable_as_asset(module_path, source_path)
    }

    fn is_in_asset(&self, source_path: &[u8]) -> bool {
        let source_path = &*with_platform_separators(source_path);
        let mut assets = self.assets.iter();
        assets.any(|asset| is_at_or_below(source_path, asset))
    }

    fn find_package_folder(&self, module_path: &[u8]) -> Option<Vec<u8>> {
        find_package_root(&with_platform_separators(module_path)).map(<[u8]>::to_vec)
    }

    fn search_misses_manifest(&self, module_path: &[u8], folder: &[u8]) -> bool {
        let module_path = &*with_platform_separators(module_path);
        let folder = &*with_platform_separators(folder);
        let kind_of =
            |path: &[u8]| bun_sys::exists_at_type(bun_sys::Fd::cwd(), &ZBox::from_bytes(path));
        let is_folder = || matches!(kind_of(folder), Ok(bun_sys::ExistsAtType::Directory));
        let Some(root) = find_package_root(module_path) else {
            return false;
        };
        if self.names_wanted.runs_in_place || !is_folder() {
            return false;
        }
        let files = self.files_for_file_system.lock();
        let is_above = |manifest: &[u8]| {
            bun_paths::dirname(manifest).is_some_and(|above| is_at_or_below(folder, above))
        };
        let nearest = (files.embedded_manifests.iter())
            .filter(|it| is_above(it))
            .max_by_key(|it| it.len());
        let nearest = nearest.and_then(|it| bun_paths::dirname(it));
        if nearest.is_none() && is_at_or_below(folder, root) {
            return false;
        }
        let mut current = Some(folder);
        while let Some(above) = current {
            if nearest == Some(above) {
                return false;
            }
            let manifest = [above, &[bun_paths::SEP], b"package.json"].concat();
            if kind_of(&manifest).is_ok() {
                return true;
            }
            current = bun_paths::dirname(above);
        }
        false
    }

    fn is_own_module_of_project(&self, module_path: &[u8]) -> bool {
        !self.names_wanted.runs_in_place
            && find_node_modules_parent(&with_platform_separators(module_path)).is_none()
    }

    fn is_on_disk(&self, module_path: &[u8], source_path: &[u8]) -> bool {
        let module_path = &*with_platform_separators(module_path);
        let source_path = &*with_platform_separators(source_path);
        let kind = || bun_sys::exists_at_type(bun_sys::Fd::cwd(), &ZBox::from_bytes(source_path));
        !self.names_wanted.runs_in_place
            && self.is_near_code(module_path, source_path)
            && kind().is_ok()
    }

    fn is_embedding_undecided(&self, module_path: &[u8], source_path: &[u8]) -> bool {
        self.is_found_by_pattern(source_path)
            && self.is_embeddable_as_asset(module_path, source_path)
    }

    fn is_asset_unreachable(&self, module_path: &[u8], source_path: &[u8]) -> bool {
        let module_path = &*with_platform_separators(module_path);
        let source_path = &*with_platform_separators(source_path);
        let root = without_trailing_slash_windows_path(&self.names_wanted.root_directory);
        // Almost every file is below the root.
        if self.names_wanted.runs_in_place || is_at_or_below(source_path, root) {
            return false;
        }
        let kind = || bun_sys::exists_at_type(bun_sys::Fd::cwd(), &ZBox::from_bytes(source_path));
        let mut assets = self.assets.iter();
        assets.any(|asset| is_at_or_below(source_path, asset))
            && count_lexical_levels_above(root, source_path) >= 2
            && count_levels_above(root, module_path) == 0
            && kind().is_ok()
    }

    fn is_searched_for(&self, source_path: &[u8]) -> bool {
        is_package_json(source_path)
    }

    fn is_embedded_implicitly(&self, source_path: &[u8], is_query: bool) -> bool {
        let source_path = &*with_platform_separators(source_path);
        let files = self.files_for_file_system.lock();
        files.is_embedded(source_path, is_query)
    }

    fn list_files_embedded_implicitly(&self) -> Vec<Vec<u8>> {
        let files = self.files_for_file_system.lock();
        let embedded = files.implicitly_embedded.iter().chain(&files.asked_about);
        let mut paths: Vec<Vec<u8>> = embedded.map(|it| it.to_vec()).collect();
        paths.sort_unstable();
        paths.dedup();
        paths
    }

    fn fill_package_json_gaps(&self, module_paths: &[&[u8]]) -> Vec<(Vec<u8>, Vec<u8>)> {
        let has_any = !(self.files_for_file_system.lock().embedded_manifests).is_empty();
        let (mut added, mut closed) = (Vec::new(), FxHashSet::default());
        let mut asked: FxHashSet<Vec<u8>> = FxHashSet::default();
        for path in module_paths.iter().filter(|_| has_any) {
            let path = with_platform_separators(path);
            // Whatever is added has an embedded `package.json` above it, so a folder that had none above it still has none.
            if let Some(folder) = bun_paths::dirname(&path).filter(|it| !asked.contains(*it)) {
                asked.insert(folder.to_vec());
                if !closed.contains(folder) {
                    self.fill_gaps_above(folder, &mut closed, &mut added);
                }
            }
        }
        self.fill_gaps_in_packages(&mut added);
        added
    }

    fn embed_package_json_files(&self, module_path: &[u8]) -> Vec<Vec<u8>> {
        let mut added = Vec::new();
        let mut folder =
            bun_paths::dirname(module_path).filter(|_| is_installed_package_file(module_path));
        while let Some(current) = folder.filter(|it| bun_paths::basename(it) != b"node_modules") {
            let path = [current, &[bun_paths::SEP], b"package.json"].concat();
            let is_new = !self.is_embedded_implicitly(&path, false);
            if is_new && self.embed_file_implicitly(b"", module_path, &path, false) {
                added.push(path);
            }
            folder = bun_paths::dirname(current).filter(|above| above.len() < current.len());
        }
        added
    }

    fn note_reads_of_unknown_paths(&self) {
        self.files_for_file_system.lock().reads_unknown_paths = true;
    }

    fn embed_file_implicitly(
        &self,
        entry_path: &[u8],
        module_path: &[u8],
        source_path: &[u8],
        is_query: bool,
    ) -> bool {
        let entry = &*with_platform_separators(entry_path);
        let source = &*with_platform_separators(source_path);
        (is_installed_package_file(source) || is_nearest_package_json(entry, source))
            && self.embed_eligible_file(module_path, source_path, is_query)
    }

    fn read_web_assembly(&self, source_path: &[u8]) -> Option<Vec<u8>> {
        let source = &*with_platform_separators(source_path);
        if !is_regular_file(source) {
            return None;
        }
        let bytes = bun_sys::File::read_from(bun_sys::Fd::cwd(), source).ok()?;
        bytes.starts_with(b"\0asm\x01\0\0\0").then_some(bytes)
    }

    fn embed_named_file(&self, module_path: &[u8], source_path: &[u8]) -> bool {
        let source = &*with_platform_separators(source_path);
        is_installed_package_file(source)
            && !is_native_program(source)
            && self.embed_eligible_file(module_path, source_path, false)
    }

    fn list_files_to_embed(&self, folder: &[u8], reaches_below: bool) -> Vec<Vec<u8>> {
        let folder = &*with_platform_separators(folder);
        let folder = without_trailing_slash_windows_path(folder);
        match reaches_below {
            true if is_installed_package_file(folder) => list_files_below(folder),
            false if find_node_modules_parent(folder).is_some() => {
                list_folder(folder).map_or_else(Vec::new, |it| it.0)
            }
            _ => Vec::new(),
        }
    }

    fn list_excluded_folder(&self, folder: &[u8]) -> Option<Vec<Vec<u8>>> {
        let folder = &*with_platform_separators(folder);
        let folder = without_trailing_slash_windows_path(folder);
        let is_around = |asset: &Vec<u8>| is_at_or_below(folder, asset);
        if self.assets.iter().any(is_around) || !is_at_or_below(folder, &self.assets_root) {
            return None;
        }
        list_folder(folder).map(|(files, _)| files)
    }

    fn find_symlink_in_asset(&self, source_path: &[u8]) -> Option<Vec<u8>> {
        let source_path = &*with_platform_separators(source_path);
        let is_around = |asset: &&Vec<u8>| is_at_or_below(source_path, asset);
        let around = self.assets.iter().filter(is_around);
        let asset = around.max_by_key(|it| it.len())?;
        let is_end = |&at: &usize| bun_paths::is_sep_any(source_path[at]);
        let ends = (asset.len() + 1..source_path.len()).filter(is_end);
        let ends = ends.chain([source_path.len()]);
        let mut names = ends.map(|end| &source_path[..end]);
        let link = names.find(|name| is_reached_through_symlink(asset, name))?;
        Some(link.to_vec())
    }

    fn warn_if_not_embedded(&self, source_path: &[u8], warning: Msg) {
        let mut files = self.files_for_file_system.lock();
        files
            .warnings_if_not_embedded
            .push((source_path.into(), warning));
    }

    fn parse_data<'s>(
        &self,
        file: &SourceFile<'_>,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        log: &mut Log,
    ) -> Result<DataModule<'s>, DataFailure> {
        data_loaders::parse_data(&self.context, &self.embedded, file, arena, atoms, log)
    }

    fn bundle_pages(&self, pages: &[&[u8]], log: &mut Log) -> Result<Vec<Vec<u8>>, Failed> {
        page_bundles::bundle_pages(&self.context, &self.embedded, pages, log)
    }

    fn compile_components(&self, file: &ComponentFile<'_>, observer: &mut dyn Observer) -> bool {
        components::compile_components(&self.context, file, observer, None, &mut Log::init())
    }

    fn expand_globs(&self, file: &ComponentFile<'_>) -> Vec<ExpandedImportMetaGlob> {
        components::expand_globs(&self.context, file, &mut Log::init())
    }

    fn check_embedded_files(&self, log: &mut Log) -> Result<(), Failed> {
        self.embedded.check_names(log)
    }
}

#[cfg(test)]
mod tests {
    use super::{BundlerServices, NamesWanted, with_ast_scope, with_test_context};
    use bun_aot::SourceProvider;
    use bun_aot::load::source_provider::ModuleName;
    use bun_ast::{E, Expr, ExprData, Loc};

    fn allocate_array() -> Expr {
        Expr::init(E::Array::default(), Loc::EMPTY)
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn build_without_plugins_has_no_load_plugin() {
        with_test_context(
            |_| {},
            |context| {
                let services = BundlerServices::new(
                    context.bundle_pointer(),
                    &context.module_prefix,
                    &[],
                    NamesWanted {
                        runs_in_place: true,
                        loads_code_from_disk: false,
                        root_directory: Box::default(),
                    },
                );
                for namespace in [&b"file"[..], b"virtual"] {
                    assert!(!services.has_load_plugin(ModuleName {
                        namespace,
                        path: b"/project/a.ts",
                    }));
                }
                assert!(services.shut_down().is_empty());
            },
        );
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn nested_ast_scopes_restore_outer_store() {
        with_ast_scope(|_| {
            let before = allocate_array();
            with_ast_scope(|_| {
                with_ast_scope(|_| {
                    assert!(matches!(allocate_array().data, ExprData::EArray(_)));
                });
                assert!(matches!(allocate_array().data, ExprData::EArray(_)));
            });
            let after = allocate_array();
            assert!(matches!(before.data, ExprData::EArray(_)));
            assert!(matches!(after.data, ExprData::EArray(_)));
        });
    }
}
