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
use bun_sema_driver::host::{from_native, to_native};
use bun_threading::Guarded;
use core::ptr::NonNull;

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
        let pool = self.bundle().graph.pool();
        let mut worker = scopeguard::guard(Worker::get(pool), |worker| worker.unget());
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
    let mut event_loop = bun_event_loop::AnyEventLoop::default();
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
        Some(NonNull::from(&mut event_loop)),
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

pub(super) fn is_at_or_below(path: &[u8], folder: &[u8]) -> bool {
    let rest = path.strip_prefix(folder);
    rest.is_some_and(|rest| rest.first().is_none_or(|&byte| bun_paths::is_sep_any(byte)))
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

    fn is_found_by_pattern(&self, source_path: &[u8]) -> bool {
        let files = self.files_for_file_system.lock();
        let mut found = files.data_found_by_patterns.iter();
        found.any(|found| &found[..] == source_path)
    }

    fn is_embeddable_as_asset(&self, source_path: &[u8]) -> bool {
        let kind = || bun_sys::exists_at_type(bun_sys::Fd::cwd(), &ZBox::from_bytes(source_path));
        let mut assets = self.assets.iter();
        is_at_or_below(source_path, &self.assets_root)
            && !assets.any(|asset| is_at_or_below(source_path, asset))
            && matches!(kind(), Ok(bun_sys::ExistsAtType::File))
    }

    pub(crate) fn take_files_for_file_system(&self) -> FilesForFileSystem {
        let mut files = core::mem::take(&mut *self.files_for_file_system.lock());
        for paths in [&mut files.data_found_by_patterns, &mut files.code_seen] {
            paths.sort_unstable();
            paths.dedup();
        }
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
    /// A data file's path and the warning if `node:fs` can't find it. Sorted, without duplicates.
    pub warnings_if_not_embedded: Vec<(Box<[u8]>, Msg)>,
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
        let kept = MimeType::MimeType::init(&kept, false, None);
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

    fn is_embeddable_only_by_asset(&self, source_path: &[u8]) -> bool {
        !self.is_found_by_pattern(source_path) && self.is_embeddable_as_asset(source_path)
    }

    fn is_embedding_undecided(&self, source_path: &[u8]) -> bool {
        self.is_found_by_pattern(source_path) && self.is_embeddable_as_asset(source_path)
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
